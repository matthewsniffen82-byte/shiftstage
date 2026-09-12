import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

type VenuePublicationAction = "admin_edit" | "admin_publish" | "owner_approve" | "owner_request_changes";
type VenuePublicationRow = { id: string; name: string; is_active: boolean; page_review_status: string; [key: string]: unknown };

export async function changeVenuePublication(
  client: SupabaseClient,
  actorUserId: string,
  venueId: string,
  action: VenuePublicationAction,
  changes: Record<string, unknown>,
  columns: string,
): Promise<VenuePublicationRow> {
  const unavailable = () => new PublicApiError(
    "UNAVAILABLE", "We couldn't confirm the venue change. Refresh the venue before trying again.", 503,
  );
  let result;
  try {
    result = await client.rpc("change_venue_publication_safely", {
      p_actor_user_id: actorUserId, p_venue_id: venueId, p_action: action, p_changes: changes,
    });
  } catch {
    throw unavailable();
  }
  if (result.error) {
    if (result.error.code === "42501") throw new PublicApiError("FORBIDDEN", "Your account cannot make this venue change.", 403);
    if (result.error.code === "22023") throw new PublicApiError("INVALID_REQUEST", "Check the venue change and try again.", 400);
    if (result.error.code === "40001") throw new PublicApiError("CONFLICT", "The venue changed while saving. Refresh and try again.", 409);
    throw unavailable();
  }
  const data = result.data;
  const fields = columns.split(",").map(field => field.trim());
  if (!data || typeof data !== "object" || Array.isArray(data) || data.id !== venueId
    || typeof data.name !== "string" || typeof data.is_active !== "boolean" || typeof data.page_review_status !== "string"
    || fields.some(field => !Object.hasOwn(data, field))) throw unavailable();
  // Keep each existing caller's projection instead of spreading the RPC row.
  return Object.fromEntries(fields.map(field => [field, data[field]])) as VenuePublicationRow;
}
