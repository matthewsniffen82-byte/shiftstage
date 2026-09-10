import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_STATUSES = new Set(["open", "in_progress", "resolved", "cancelled"]);

export async function createVenueNfcSupportRequest(client: SupabaseClient, input: {
  userId: string; venueId: string; tagId: string; requestType: string; notes: string; requestId: string;
}) {
  const { data, error } = await client.rpc("create_venue_nfc_support_safely", {
    p_user_id: input.userId, p_venue_id: input.venueId, p_tag_id: input.tagId,
    p_request_type: input.requestType, p_notes: input.notes.trim() || null, p_request_id: input.requestId,
  });
  if (error) {
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "This account cannot request support for that venue.", 403);
    if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "This tap sticker is not assigned to your venue.", 404);
    if (error.code === "22023") throw new PublicApiError("CONFLICT", "This request ID has different details. Close the form and start a new request.", 409);
    if (error.code === "P0001") throw new PublicApiError("CONFLICT", "Too many support messages. Wait one minute and try again.", 429);
    if (["40001", "40P01", "55P03", "PGRST202"].includes(error.code)) {
      throw new PublicApiError("UNAVAILABLE", "The request could not be confirmed. Try again with the same details.", 503);
    }
    throw error;
  }
  const row = data?.request;
  if (!row || Array.isArray(row) || row.id !== input.requestId.toLowerCase()
    || row.venue_id !== input.venueId.toLowerCase() || row.requested_by_user_id !== input.userId.toLowerCase()
    || row.nfc_tag_id !== input.tagId.toLowerCase() || row.request_type !== input.requestType
    || row.notes !== (input.notes.trim() || null) || !REQUEST_STATUSES.has(row.status)
    || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
    || typeof data.threadId !== "string" || !UUID.test(data.threadId)
    || typeof data.duplicate !== "boolean" || !Array.isArray(data.notifications)) {
    throw new PublicApiError("UNAVAILABLE", "The request could not be confirmed. Try again with the same details.", 503);
  }
  return {
    supportRequest: {
      id: row.id as string, nfc_tag_id: row.nfc_tag_id as string, request_type: row.request_type as string,
      notes: row.notes as string | null, status: row.status as string, created_at: row.created_at as string,
    },
    duplicate: data.duplicate as boolean,
    notifications: data.notifications,
  };
}
