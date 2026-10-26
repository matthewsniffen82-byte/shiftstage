import { PublicApiError } from "../api";
import { SUPPORT_USER_ROLES } from "./support";

export type SupportReader = { userId: string; admin: boolean };

// Call only after authenticating the account and, for admins, checking support scope.
function incomingMessages(client: any, reader: SupportReader, count = false) {
  let query = client.from("support_messages")
    .select("id,support_threads!inner(id)", count ? { count: "exact", head: true } : undefined)
    .is("read_at", null)
    .or("sender_kind.is.null,sender_kind.eq.human")
    .in("support_threads.user_role", SUPPORT_USER_ROLES);
  if (reader.admin) {
    query = query.in("sender_role", SUPPORT_USER_ROLES).is("support_threads.admin_archived_at", null);
  } else {
    query = query.eq("sender_role", "admin").eq("support_threads.user_id", reader.userId);
  }
  return query;
}

export async function countUnreadSupportMessages(client: any, reader: SupportReader) {
  const { count, error } = await incomingMessages(client, reader, true);
  if (error) throw error;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Unread messages could not be counted.");
  return count as number;
}

export function parseReadMessageIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
    throw new PublicApiError("INVALID_REQUEST", "Choose up to 100 messages to mark as read.", 400);
  }
  return [...new Set(value as string[])];
}

export async function markSupportMessagesRead(client: any, reader: SupportReader, messageIds: string[]) {
  // Restrict to incoming messages this reader may see. Never mark a whole thread:
  // a reply arriving after the client rendered must remain unread.
  const { data, error } = await incomingMessages(client, reader).in("id", messageIds);
  if (error) throw error;
  const allowed = (data || []).map((message: { id: string }) => message.id);
  if (!allowed.length) return [];
  const { data: updated, error: updateError } = await client.from("support_messages")
    .update({ read_at: new Date().toISOString() }).in("id", allowed).is("read_at", null).select("id");
  if (updateError) throw updateError;
  return (updated || []).map((message: { id: string }) => message.id);
}
