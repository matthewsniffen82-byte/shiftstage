import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { createRequestSupabaseContext } from "../supabase/request";
import { getVipState, vipId } from "./vip";
import type { InternalMember } from "./internal-roster";

/** Recheck the invited account, club membership and current dancer privacy for every read. */
export async function vipProfileScope(client: SupabaseClient, request: Request, venueId: string) {
  vipId(venueId);
  const auth = await createRequestSupabaseContext(request, { role: "customer" });
  const state = await getVipState(client, auth.user.id, new URLSearchParams({ view: "account", venueId }));
  const venue = state.venues.find(item => item.id === venueId);
  if (!venue) throw new PublicApiError("FORBIDDEN", "This club's VIP access is unavailable.", 403);
  return { venueId, venueName: venue.name, venueSlug: undefined, venueLogoUrl: undefined,
    userId: auth.user.id, role: null, session: auth.session || null, link: null };
}

export async function vipProfileMembers(client: SupabaseClient, venueId: string): Promise<InternalMember[]> {
  const { data, error } = await client.rpc("vip_eligible_dancers", { p_venue: venueId });
  if (error) throw error;
  if (!data?.length) return [];
  const ids = data.map((row: { id: string }) => row.id);
  const [profiles, shifts] = await Promise.all([
    client.from("dancer_profiles").select("id,stage_name,avatar_storage_path").in("id", ids).eq("is_incognito", false),
    client.from("shifts").select("dancer_id,location_verification_expires_at").in("dancer_id", ids).eq("venue_id", venueId)
      .eq("status", "posted").not("checked_in_at", "is", null).is("checked_out_at", null)
      .eq("location_status", "club_confirmed").gt("location_verification_expires_at", new Date().toISOString()),
  ]);
  if (profiles.error) throw profiles.error;
  if (shifts.error) throw shifts.error;
  return (profiles.data || []).map(profile => ({ ...profile, avatar_storage_path: profile.avatar_storage_path || "",
    working_until: (shifts.data || []).filter(shift => shift.dancer_id === profile.id)
      .map(shift => shift.location_verification_expires_at).sort().at(-1) || "" }));
}
