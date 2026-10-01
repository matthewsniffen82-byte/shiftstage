import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

/** The caller must first authorize the active table capability with internalScope. */
export async function cancelInternalRequest(client: SupabaseClient, venueId: string, linkId: string, dancerId: string, requestId: string) {
  const { data, error } = await client.rpc("cancel_internal_roster_request", {
    p_venue_id: venueId, p_link_id: linkId, p_dancer_id: dancerId, p_request_id: requestId,
  });
  if (error?.code === "40001") throw new PublicApiError("CONFLICT", "This request is no longer available. Refresh and try again.", 409);
  if (error) throw error;
  if (data?.id !== requestId || data?.status !== "cancelled") throw new Error("Cancellation could not be confirmed.");
  return data as { id: string; status: "cancelled" };
}
