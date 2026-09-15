import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { createAdminSupabaseClient } from "../supabase/admin";
import { normalizeShuttleRequest } from "./club-deal-transportation";
import type { PhonePickupRequest, PickupVenue } from "./pickup-domain";
import { pickupDate, pickupPageOffset, pickupUuid } from "./pickup-validation";

// Phone handoffs predate pickup chat and remain in their original receipt table.
// Resolve current owner/manager access with the authenticated client before any
// service read; historic notification recipients do not grant ongoing access.
export async function listPhonePickupRequests(client: SupabaseClient, search: URLSearchParams) {
  const empty = { phoneRequests: [] as PhonePickupRequest[], hasMorePhoneRequests: false };
  if (search.get("status") || !["active", "all"].includes(search.get("group") || "active")) return empty;
  const offset = pickupPageOffset(search.get("phoneOffset"));
  const selectedVenue = search.get("venueId") ? pickupUuid(search.get("venueId")) : "";
  const from = pickupDate(search.get("from")), to = pickupDate(search.get("to"));
  const { data: venues, error: accessError } = await client.rpc("pickup_manageable_venues");
  if (accessError) throw new PublicApiError("UNAVAILABLE", "Unable to verify phone pickup access. Please retry.", 503);
  const allowed = new Map<string, PickupVenue>((venues as PickupVenue[] || [])
    .filter(venue => !selectedVenue || venue.id === selectedVenue).map(venue => [venue.id, venue]));
  if (!allowed.size) return empty;

  let query = createAdminSupabaseClient().from("club_shuttle_requests")
    .select("id,venue_id,created_at,notification_rows").in("venue_id", [...allowed.keys()])
    .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 30);
  if (from) query = query.gte("created_at", from + "T00:00:00Z");
  if (to) query = query.lt("created_at", new Date(Date.parse(to) + 86400000).toISOString());
  const { data, error } = await query;
  if (error) throw new PublicApiError("UNAVAILABLE", "Unable to load phone pickup requests. Please retry.", 503);
  const phoneRequests = (data || []).slice(0, 30).map(row => {
    const venue = allowed.get(row.venue_id);
    const payload = row.notification_rows?.find((notice: { payload?: Record<string, unknown> }) =>
      notice.payload?.kind === "club_shuttle_request" && notice.payload.requestId === row.id && notice.payload.venueId === row.venue_id)?.payload;
    const details = payload && normalizeShuttleRequest({ ...payload, handoffAccepted: true });
    if (!venue || !details) throw new PublicApiError("UNAVAILABLE", "Unable to read a phone pickup request. Please retry.", 503);
    // Return one guest record per receipt, without notification recipients or hashes.
    return { id: row.id, venue_id: row.venue_id, venue_name: venue.name, requested_at: row.created_at,
      name: details.name, location: details.location, phone: details.phone, email: details.email, party_size: details.partySize };
  });
  return { phoneRequests, hasMorePhoneRequests: (data?.length || 0) > 30 };
}
