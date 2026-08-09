import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows } from "./notification-delivery";
import type { UserRole } from "./types";

type DancrClient = SupabaseClient;

export type SupportUserRole = Extract<UserRole, "customer" | "dancer" | "venue">;

export const SUPPORT_USER_ROLES: SupportUserRole[] = ["customer", "dancer", "venue"];

export function isSupportUserRole(role: UserRole): role is SupportUserRole {
  return SUPPORT_USER_ROLES.includes(role as SupportUserRole);
}

type SupportThreadRow = {
  id: string;
  user_id: string;
  user_role: UserRole;
  subject: string;
  status: string;
  assigned_admin_id?: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  app_users?: { display_name?: string | null; email?: string | null; role?: UserRole | null } | Array<{ display_name?: string | null; email?: string | null; role?: UserRole | null }> | null;
  support_messages?: SupportMessageRow[];
};

type SupportMessageRow = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_role: UserRole;
  sender_kind?: "human" | "ai" | "system";
  body: string;
  read_at: string | null;
  created_at: string;
};

const USER_THREAD_SELECT = `
  id,
  user_id,
  user_role,
  subject,
  status,
  assigned_admin_id,
  last_message_at,
  created_at,
  updated_at,
  support_messages(id, thread_id, sender_id, sender_role, sender_kind, body, read_at, created_at)
`;

const ADMIN_THREAD_SELECT = `
  id,
  user_id,
  user_role,
  subject,
  status,
  assigned_admin_id,
  last_message_at,
  created_at,
  updated_at,
  app_users(display_name, email, role),
  support_messages(id, thread_id, sender_id, sender_role, sender_kind, body, read_at, created_at)
`;

export async function listOwnSupportThreads(client: DancrClient, userId: string) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(USER_THREAD_SELECT)
    .eq("user_id", userId)
    .in("user_role", SUPPORT_USER_ROLES)
    .order("last_message_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(mapSupportThread);
}

export async function createOwnSupportMessage(client: DancrClient, input: {
  userId: string;
  role: SupportUserRole;
  subject?: string | null;
  body: string;
  threadId?: string | null;
}, adminClient: DancrClient) {
  const body = requiredMessage(input.body);
  await enforceSupportMessageRateLimit(client, input.userId);
  const now = new Date().toISOString();
  let threadId = input.threadId?.trim() || "";

  if (threadId) {
    const { data: thread, error: threadError } = await (client as any)
      .from("support_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", input.userId)
      .in("user_role", SUPPORT_USER_ROLES)
      .maybeSingle();

    if (threadError) throw threadError;
    if (!thread) throw new Error("Support thread not found.");
  } else {
    const subject = input.subject?.trim() || "Message to admin";
    if (subject.length > 160) throw new Error("Keep the subject under 160 characters.");
    const { data: thread, error: createError } = await (client as any)
      .from("support_threads")
      .insert({
        user_id: input.userId,
        user_role: input.role,
        subject,
        status: "open",
        last_message_at: now,
      })
      .select("id")
      .single();

    if (createError) throw createError;
    threadId = thread.id;
  }

  const { error: messageError } = await (client as any)
    .from("support_messages")
    .insert({
      thread_id: threadId,
      sender_id: input.userId,
      sender_role: input.role,
      sender_kind: "human",
      body,
    });

  if (messageError) throw messageError;

  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update({ status: "open", last_message_at: now, updated_at: now })
    .eq("id", threadId)
    .eq("user_id", input.userId);

  if (updateError) throw updateError;

  try {
    await notifyActiveAdmins(adminClient, {
      threadId,
      userRole: input.role,
      subject: input.subject?.trim() || "Message to admin",
      body,
    });
  } catch (error) {
    console.error("SUPPORT_ADMIN_NOTIFICATION_FAILED", {
      threadId,
      errorCode: databaseErrorCode(error),
    });
  }

  return getOwnSupportThread(client, input.userId, threadId);
}

export async function listAdminSupportThreads(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(ADMIN_THREAD_SELECT)
    .in("user_role", SUPPORT_USER_ROLES)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data || []).map(mapSupportThread);
}

export async function replyToSupportThread(client: DancrClient, input: {
  adminId: string;
  threadId: string;
  body: string;
}) {
  const body = requiredMessage(input.body);
  const now = new Date().toISOString();
  const { data: thread, error: threadError } = await (client as any)
    .from("support_threads")
    .select("id, user_id, user_role, subject")
    .eq("id", input.threadId)
    .in("user_role", SUPPORT_USER_ROLES)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!thread) throw new Error("Support thread not found.");

  const { error: messageError } = await (client as any).from("support_messages").insert({
    thread_id: input.threadId,
    sender_id: input.adminId,
    sender_role: "admin",
    sender_kind: "human",
    body,
  });

  if (messageError) throw messageError;

  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update({
      status: "answered",
      assigned_admin_id: input.adminId,
      last_message_at: now,
      updated_at: now,
    })
    .eq("id", input.threadId);

  if (updateError) throw updateError;

  const notificationRow = {
    recipient_id: thread.user_id,
    notification_type: "support_message" as const,
    channel: "in_app",
    title: "Admin replied",
    body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
    payload: { threadId: input.threadId, subject: thread.subject },
    sent_at: now,
  };
  const { error: notificationError } = await (client as any).from("notifications").insert(notificationRow);
  if (notificationError) throw notificationError;
  await deliverNotificationRows(client, [notificationRow]);

  return getAdminSupportThread(client, input.threadId);
}

async function getOwnSupportThread(client: DancrClient, userId: string, threadId: string) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(USER_THREAD_SELECT)
    .eq("id", threadId)
    .eq("user_id", userId)
    .in("user_role", SUPPORT_USER_ROLES)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Support thread not found.");
  return mapSupportThread(data);
}

async function getAdminSupportThread(client: DancrClient, threadId: string) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(ADMIN_THREAD_SELECT)
    .eq("id", threadId)
    .in("user_role", SUPPORT_USER_ROLES)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Support thread not found.");
  return mapSupportThread(data);
}

function requiredMessage(value: string) {
  const text = value.trim();
  if (text.length < 2) throw new Error("Enter a message before sending.");
  if (text.length > 4000) throw new Error("Keep the message under 4,000 characters.");
  return text;
}

async function enforceSupportMessageRateLimit(client: DancrClient, userId: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await (client as any)
    .from("support_messages")
    .select("*", { count: "exact", head: true })
    .eq("sender_id", userId)
    .eq("sender_kind", "human")
    .gte("created_at", since);

  if (error) throw error;
  if ((count || 0) >= 12) throw new Error("Too many support messages. Wait one minute and try again.");
}

async function notifyActiveAdmins(client: DancrClient, input: {
  threadId: string;
  userRole: SupportUserRole;
  subject: string;
  body: string;
}) {
  const { data: admins, error } = await (client as any)
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .eq("account_state", "active");

  if (error) throw error;
  if (!admins?.length) {
    console.error("SUPPORT_MESSAGE_WITHOUT_ACTIVE_ADMIN", { threadId: input.threadId });
    return;
  }

  const now = new Date().toISOString();
  const rows = admins.map((admin: { id: string }) => ({
    recipient_id: admin.id,
    notification_type: "support_message" as const,
    channel: "in_app",
    title: `New ${input.userRole} support message`,
    body: `${input.subject}: ${input.body}`.slice(0, 500),
    payload: {
      threadId: input.threadId,
      userRole: input.userRole,
    },
    sent_at: now,
  }));

  const { error: notificationError } = await (client as any).from("notifications").insert(rows);
  if (notificationError) throw notificationError;
  await deliverNotificationRows(client, rows);
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as { code?: unknown; name?: unknown };
  return String(candidate.code || candidate.name || "database_error").slice(0, 120);
}

function mapSupportThread(thread: SupportThreadRow) {
  const account = Array.isArray(thread.app_users) ? thread.app_users[0] : thread.app_users;
  return {
    id: thread.id,
    userId: thread.user_id,
    userRole: thread.user_role,
    userName: account?.display_name || null,
    userEmail: account?.email || null,
    subject: thread.subject,
    status: thread.status,
    assignedAdminId: thread.assigned_admin_id || null,
    lastMessageAt: thread.last_message_at,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messages: (thread.support_messages || [])
      .filter((message) => message.sender_kind !== "ai" && message.sender_kind !== "system")
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((message) => ({
        id: message.id,
        threadId: message.thread_id,
        senderId: message.sender_id,
        senderRole: message.sender_role,
        senderKind: "human",
        body: message.body,
        readAt: message.read_at,
        createdAt: message.created_at,
      })),
  };
}
