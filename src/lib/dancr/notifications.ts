import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function getUserNotifications(client: DancrClient, userId: string, unreadOnly = false) {
  let query = (client as any)
    .from("notifications")
    .select("id, notification_type, channel, title, body, payload, read_at, sent_at, created_at")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unreadOnly) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((notification: any) => ({
    id: notification.id,
    type: notification.notification_type,
    channel: notification.channel,
    title: notification.title,
    body: notification.body,
    payload: notification.payload,
    readAt: notification.read_at,
    sentAt: notification.sent_at,
    createdAt: notification.created_at,
  }));
}

export async function markNotificationRead(client: DancrClient, userId: string, notificationId: string) {
  const readAt = new Date().toISOString();
  const { data, error } = await (client as any)
    .from("notifications")
    .update({ read_at: readAt })
    .eq("id", notificationId)
    .eq("recipient_id", userId)
    .select("id, read_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Notification not found.");

  return { id: data.id, readAt: data.read_at };
}

export async function markAllNotificationsRead(client: DancrClient, userId: string) {
  const readAt = new Date().toISOString();
  const { data, error } = await (client as any)
    .from("notifications")
    .update({ read_at: readAt })
    .eq("recipient_id", userId)
    .is("read_at", null)
    .select("id");

  if (error) throw error;

  return { readAt, count: data?.length || 0 };
}
