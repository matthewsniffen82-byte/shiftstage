import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

/** The caller must first authorize the active table capability with internalScope. */
export async function cancelInternalRequest(client: SupabaseClient, venueId: string, linkId: string, dancerId: string, requestId: string) {
  // The status predicate is checked under the database row lock: a concurrent
  // completion wins safely. A retry can never cancel a replacement request.
  const scoped = () => client.from("internal_roster_requests")
    .select("id,status").eq("id", requestId).eq("venue_id", venueId).eq("link_id", linkId).eq("dancer_id", dancerId);
  const { data, error } = await client.from("internal_roster_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", requestId).eq("venue_id", venueId).eq("link_id", linkId).eq("dancer_id", dancerId)
    .in("status", ["pending", "acknowledged"]).select("id,status").maybeSingle();
  if (error) throw error;
  if (data) return data;
  const existing = await scoped().maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.status === "cancelled") return existing.data;
  throw new PublicApiError("CONFLICT", existing.data?.status === "completed"
    ? "Club staff already completed this request. It can no longer be cancelled."
    : "This request is no longer available. Refresh and try again.", 409);
}
