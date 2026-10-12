import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Staff-only inbox. Keep a request actionable after its dancer checks out. */
export async function internalOpenRequests(client: SupabaseClient, venueId: string) {
  const { data, error } = await client.from("internal_roster_requests")
    .select("id,link_id,dancer_id,status,created_at,attendance,attendance_recorded_at").eq("venue_id", venueId)
    .in("status", ["pending", "acknowledged"]).gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString()).order("created_at").limit(200);
  if (error) throw error;
  if (!data?.length) return [];
  const profiles = await client.from("dancer_profiles").select("id,stage_name").in("id", [...new Set(data.map(row => row.dancer_id))]);
  if (profiles.error) throw profiles.error;
  const names = new Map((profiles.data || []).map(row => [row.id, row.stage_name]));
  return data.map(row => ({ ...row, dancerName: names.get(row.dancer_id) || "Dancer" }));
}

/** Call only after the dancer and venue have passed Internal roster authorization. */
export async function internalRequestsTonight(client: SupabaseClient, venueId: string, dancerId: string) {
  const { data: shift, error } = await client.from("shifts")
    .select("checked_in_at,location_verification_expires_at")
    .eq("venue_id", venueId).eq("dancer_id", dancerId).eq("status", "posted")
    .not("checked_in_at", "is", null).is("checked_out_at", null)
    .eq("location_status", "club_confirmed").gt("location_verification_expires_at", new Date().toISOString())
    .order("checked_in_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!shift) return 0;
  // Saved rows are unique by table + request key. Replayed submissions cannot
  // inflate the count. Count sent requests, including ones staff have finished.
  const result = await client.from("internal_roster_requests").select("id", { count: "exact", head: true })
    .eq("venue_id", venueId).eq("dancer_id", dancerId)
    .gte("created_at", shift.checked_in_at).lt("created_at", shift.location_verification_expires_at);
  if (result.error) throw result.error;
  if (result.count === null) throw new Error("Request count unavailable.");
  return result.count;
}

/** The table's open requests only; never expose another table's activity. */
export async function internalTableRequestStates(client: SupabaseClient, venueId: string, linkId: string) {
  const { data, error } = await client.from("internal_roster_requests").select("id,dancer_id,status")
    .eq("venue_id", venueId).eq("link_id", linkId).in("status", ["pending", "acknowledged"])
    .gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString()).limit(50);
  if (error) throw error;
  return new Map<string, { id: string; status: "pending" | "acknowledged" }>((data || []).map(row => [row.dancer_id, { id: row.id, status: row.status }]));
}
