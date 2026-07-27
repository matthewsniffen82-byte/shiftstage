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
  escalation_status?: string;
  escalation_category?: string | null;
  escalation_reason?: string | null;
  escalation_priority?: string | null;
  escalated_at?: string | null;
  assigned_admin_id?: string | null;
  ai_reply_count?: number;
  last_ai_response_id?: string | null;
  last_ai_replied_at?: string | null;
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
  metadata?: Record<string, unknown>;
  created_at: string;
};

const USER_THREAD_SELECT = `
  id,
  user_id,
  user_role,
  subject,
  status,
  escalation_status,
  escalation_category,
  escalation_reason,
  escalation_priority,
  escalated_at,
  assigned_admin_id,
  ai_reply_count,
  last_ai_response_id,
  last_ai_replied_at,
  last_message_at,
  created_at,
  updated_at,
  support_messages(id, thread_id, sender_id, sender_role, sender_kind, body, read_at, metadata, created_at)
`;

const ADMIN_THREAD_SELECT = `
  id,
  user_id,
  user_role,
  subject,
  status,
  escalation_status,
  escalation_category,
  escalation_reason,
  escalation_priority,
  escalated_at,
  assigned_admin_id,
  ai_reply_count,
  last_ai_response_id,
  last_ai_replied_at,
  last_message_at,
  created_at,
  updated_at,
  app_users(display_name, email, role),
  support_messages(id, thread_id, sender_id, sender_role, sender_kind, body, read_at, metadata, created_at)
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
  await enforceSupportMessageRateLimit(client, input.userId);
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
  return getOwnSupportThread(client, input.userId, threadId);
}

export async function listAdminSupportThreads(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select(ADMIN_THREAD_SELECT)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data || [])
    .map(mapSupportThread)
    .sort((left: any, right: any) => (
      Number(right.escalationStatus === "escalated") - Number(left.escalationStatus === "escalated") ||
      escalationPriorityRank(right.escalationPriority) - escalationPriorityRank(left.escalationPriority) ||
      Date.parse(right.lastMessageAt || right.createdAt || "") - Date.parse(left.lastMessageAt || left.createdAt || "")
    ));
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
    sender_kind: "human",
    body,
  });

  if (messageError) throw messageError;

  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update({
      status: "answered",
      escalation_status: "resolved",
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

export async function getSupportThreadForAutomation(client: DancrClient, userId: string, threadId: string) {
  return getOwnSupportThread(client, userId, threadId);
}

export async function addAutomatedSupportReply(client: DancrClient, input: {
  threadId: string;
  body: string;
  responseId: string;
  model: string;
  confidence: number;
}) {
  const body = requiredMessage(input.body);
  const now = new Date().toISOString();
  const { data: message, error: messageError } = await (client as any)
    .from("support_messages")
    .insert({
      thread_id: input.threadId,
      sender_id: null,
      sender_role: "admin",
      sender_kind: "ai",
      body,
      metadata: {
        provider: "openai",
        responseId: input.responseId,
        model: input.model,
        confidence: input.confidence,
      },
    })
    .select("id")
    .single();

  if (messageError) throw messageError;

  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update({
      status: "answered",
      escalation_status: "none",
      escalation_category: null,
      escalation_reason: null,
      escalation_priority: null,
      escalated_at: null,
      ai_reply_count: (await getAiReplyCount(client, input.threadId)) + 1,
      last_ai_response_id: input.responseId,
      last_ai_replied_at: now,
      last_message_at: now,
      updated_at: now,
    })
    .eq("id", input.threadId);

  if (updateError) throw updateError;
  return { messageId: message.id as string };
}

export async function escalateSupportThread(client: DancrClient, input: {
  threadId: string;
  category: string;
  reason: string;
  priority: "low" | "normal" | "high" | "urgent";
  acknowledgement?: string;
  model?: string;
  responseId?: string;
  confidence?: number;
}) {
  const now = new Date().toISOString();
  let messageId: string | null = null;

  if (input.acknowledgement?.trim()) {
    const { data: message, error: messageError } = await (client as any)
      .from("support_messages")
      .insert({
        thread_id: input.threadId,
        sender_id: null,
        sender_role: "admin",
        sender_kind: "ai",
        body: requiredMessage(input.acknowledgement),
        metadata: {
          provider: input.model ? "openai" : "dancr",
          responseId: input.responseId || null,
          model: input.model || null,
          confidence: input.confidence ?? null,
          escalated: true,
        },
      })
      .select("id")
      .single();

    if (messageError) throw messageError;
    messageId = message.id;
  }

  const update = {
    status: "escalated",
    escalation_status: "escalated",
    escalation_category: input.category,
    escalation_reason: requiredEscalationReason(input.reason),
    escalation_priority: input.priority,
    escalated_at: now,
    last_ai_response_id: input.responseId || null,
    last_ai_replied_at: input.responseId ? now : null,
    last_message_at: messageId ? now : undefined,
    updated_at: now,
  };
  const { error: updateError } = await (client as any)
    .from("support_threads")
    .update(Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)))
    .eq("id", input.threadId);

  if (updateError) throw updateError;
  try {
    await notifyAdminsOfEscalation(client, {
      threadId: input.threadId,
      category: input.category,
      reason: input.reason,
      priority: input.priority,
    });
  } catch (error) {
    console.error("SUPPORT_ESCALATION_NOTIFICATION_FAILED", {
      threadId: input.threadId,
      priority: input.priority,
      errorCode: databaseErrorCode(error),
    });
  }
  return { messageId };
}

export async function recordSupportAiRun(client: DancrClient, input: {
  threadId: string;
  triggerMessageId?: string | null;
  responseMessageId?: string | null;
  providerResponseId?: string | null;
  model: string;
  outcome: string;
  category?: string | null;
  priority?: string | null;
  reason?: string | null;
  confidence?: number | null;
  moderation?: Record<string, unknown>;
  errorCode?: string | null;
}) {
  const { error } = await (client as any).from("support_ai_runs").insert({
    thread_id: input.threadId,
    trigger_message_id: input.triggerMessageId || null,
    response_message_id: input.responseMessageId || null,
    provider_response_id: input.providerResponseId || null,
    model: input.model,
    outcome: input.outcome,
    escalation_category: input.category || null,
    escalation_priority: input.priority || null,
    escalation_reason: input.reason || null,
    confidence: input.confidence ?? null,
    moderation: input.moderation || {},
    error_code: input.errorCode || null,
  });
  if (error) {
    console.error("SUPPORT_AI_AUDIT_FAILED", {
      threadId: input.threadId,
      outcome: input.outcome,
      errorCode: databaseErrorCode(error),
    });
    return false;
  }
  return true;
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

async function getAiReplyCount(client: DancrClient, threadId: string) {
  const { data, error } = await (client as any)
    .from("support_threads")
    .select("ai_reply_count")
    .eq("id", threadId)
    .single();
  if (error) throw error;
  return Number(data?.ai_reply_count || 0);
}

async function notifyAdminsOfEscalation(client: DancrClient, input: {
  threadId: string;
  category: string;
  reason: string;
  priority: "low" | "normal" | "high" | "urgent";
}) {
  const [{ data: thread, error: threadError }, { data: admins, error: adminsError }] = await Promise.all([
    (client as any)
      .from("support_threads")
      .select("subject, user_role")
      .eq("id", input.threadId)
      .single(),
    (client as any)
      .from("app_users")
      .select("id")
      .eq("role", "admin")
      .eq("account_state", "active"),
  ]);

  if (threadError) throw threadError;
  if (adminsError) throw adminsError;
  if (!admins?.length) {
    console.error("SUPPORT_ESCALATION_WITHOUT_ACTIVE_ADMIN", { threadId: input.threadId, priority: input.priority });
    return;
  }

  const now = new Date().toISOString();
  const rows = admins.map((admin: { id: string }) => ({
    recipient_id: admin.id,
    notification_type: "support_message" as const,
    channel: "in_app",
    title: `${input.priority === "urgent" ? "Urgent " : ""}support escalation`,
    body: `${String(thread.user_role)}: ${String(thread.subject)} — ${input.reason}`.slice(0, 500),
    payload: {
      threadId: input.threadId,
      category: input.category,
      priority: input.priority,
    },
    sent_at: now,
  }));

  const { error: notificationError } = await (client as any).from("notifications").insert(rows);
  if (notificationError) throw notificationError;
  await deliverNotificationRows(client, rows);
}

function requiredEscalationReason(value: string) {
  const text = value.trim();
  if (!text) throw new Error("Escalation reason is required.");
  return text.slice(0, 1000);
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as { code?: unknown; name?: unknown };
  return String(candidate.code || candidate.name || "database_error").slice(0, 120);
}

function escalationPriorityRank(value: unknown) {
  return ({ urgent: 4, high: 3, normal: 2, low: 1 } as Record<string, number>)[String(value)] || 0;
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
    escalationStatus: thread.escalation_status || "none",
    escalationCategory: thread.escalation_category || null,
    escalationReason: thread.escalation_reason || null,
    escalationPriority: thread.escalation_priority || null,
    escalatedAt: thread.escalated_at || null,
    assignedAdminId: thread.assigned_admin_id || null,
    aiReplyCount: Number(thread.ai_reply_count || 0),
    lastAiResponseId: thread.last_ai_response_id || null,
    lastAiRepliedAt: thread.last_ai_replied_at || null,
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
        senderKind: message.sender_kind || "human",
        body: message.body,
        readAt: message.read_at,
        metadata: message.metadata || {},
        createdAt: message.created_at,
      })),
  };
}
