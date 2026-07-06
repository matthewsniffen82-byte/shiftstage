import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows } from "./notification-delivery";
import type { UserRole } from "./types";

type DancrClient = SupabaseClient;

type SupportThreadRow = {
  id: string;
  user_id: string;
  user_role: UserRole;
  subject: string;
  status: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  app_users?: { display_name?: string | null; email?: string | null; role?: UserRole | null } | Array<{ display_name?: string | null; email?: string | null; role?: UserRole | null }> | null;
  support_messages?: SupportMessageRow[];
};

type SupportMessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: UserRole;
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
  last_message_at,
  created_at,
  updated_at,
  support_messages(id, thread_id, sender_id, sender_role, body, read_at, created_at)
`;

const ADMIN_THREAD_SELECT = `
  id,
  user_id,
  user_role,
  subject,
  status,
  last_message_at,
  created_at,
  updated_at,
  app_users(display_name, email, role),
  support_messages(id, thread_id, sender_id, sender_role, body, read_at, created_at)
`;

export async function listOwnSupportThreads(client: DancrClient, userId: string) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(USER_THREAD_SELECT)
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(mapSupportThread);
}

export async function createOwnSupportMessage(client: DancrClient, input: { userId: string; role: UserRole; subject?: string | null; body: string; threadId?: string | null }) {
  const body = requiredMessage(input.body);
  const now = new Date().toISOString();
  let threadId = input.threadId?.trim() || "";

  if (threadId) {
    const { data: thread, error: threadError } = await (client as any)
      .from("support_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", input.userId)
      .maybeSingle();

    if (threadError) throw threadError;
    if (!thread) throw new Error("Support thread not found.");
  } else {
    const subject = input.subject?.trim() || "Message to admin";
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

  const { error: messageError } = await (client as any).from("support_messages").insert({
    thread_id: threadId,
    sender_id: input.userId,
    sender_role: input.role,
    body,
  });

  if (messageError) throw messageError;

  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update({ status: "open", last_message_at: now, updated_at: now })
    .eq("id", threadId)
    .eq("user_id", input.userId);

  if (updateError) throw updateError;
  return getOwnSupportThread(client, input.userId, threadId);
}

export async function listAdminSupportThreads(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(ADMIN_THREAD_SELECT)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data || []).map(mapSupportThread);
}

export async function replyToSupportThread(client: DancrClient, input: { adminId: string; threadId: string; body: string }) {
  const body = requiredMessage(input.body);
  const now = new Date().toISOString();
  const { data: thread, error: threadError } = await (client as any)
    .from("support_threads")
    .select("id, user_id, subject")
    .eq("id", input.threadId)
    .maybeSingle();

  if (threadError) throw threadError;
  if (!thread) throw new Error("Support thread not found.");

  const { error: messageError } = await (client as any).from("support_messages").insert({
    thread_id: input.threadId,
    sender_id: input.adminId,
    sender_role: "admin",
    body,
  });

  if (messageError) throw messageError;

  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update({ status: "answered", last_message_at: now, updated_at: now })
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
    lastMessageAt: thread.last_message_at,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messages: (thread.support_messages || [])
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((message) => ({
        id: message.id,
        threadId: message.thread_id,
        senderId: message.sender_id,
        senderRole: message.sender_role,
        body: message.body,
        readAt: message.read_at,
        createdAt: message.created_at,
      })),
  };
}
