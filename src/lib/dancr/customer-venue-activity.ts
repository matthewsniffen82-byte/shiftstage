import { safeErrorMetadata } from "../security/safe-error-metadata.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicDancerProfileEligible } from "./profile-approval.ts";
import { isActiveNfcPresence } from "./shift-presence.ts";

type ActivityShift = {
  id?: string;
  dancer_id: string;
  venue_id: string;
  status: string;
  shift_source: string;
  ends_at: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  location_status?: string | null;
  location_verification_expires_at?: string | null;
  dancer_profiles?: {
    status?: string;
    verification_status?: string;
    disabled_at?: string | null;
    is_public?: boolean;
  } | null;
};

export type SavedVenueActivity = { workingNowCount: number; upcomingDancerCount: number };

export function countSavedVenueDancers(venueIds: string[], shifts: ActivityShift[], now = Date.now()) {
  const groups = new Map(venueIds.map(id => [id, { now: new Set<string>(), upcoming: new Set<string>() }]));
  for (const shift of shifts) {
    const group = groups.get(shift.venue_id);
    const dancer = shift.dancer_profiles;
    if (!group || !shift.dancer_id || shift.status !== "posted" || shift.checked_out_at) continue;
    if (!dancer || dancer.status !== "approved" || dancer.verification_status !== "approved" || !isPublicDancerProfileEligible(dancer)) continue;
    if (isActiveNfcPresence(shift, now)) group.now.add(shift.dancer_id);
    else if (shift.shift_source === "scheduled" && Date.parse(shift.ends_at) >= now) group.upcoming.add(shift.dancer_id);
  }
  return new Map<string, SavedVenueActivity>([...groups].map(([id, group]) => [id, {
    workingNowCount: group.now.size,
    upcomingDancerCount: [...group.upcoming].filter(id => !group.now.has(id)).length,
  }]));
}

export async function getSavedVenueActivity(client: SupabaseClient, venueIds: string[], now = new Date()) {
  if (!venueIds.length) return new Map<string, SavedVenueActivity>();
  const shifts: ActivityShift[] = [];
  const pageSize = 500;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from("shifts")
        .select("id, dancer_id, venue_id, status, shift_source, ends_at, checked_in_at, checked_out_at, location_status, location_verification_expires_at, dancer_profiles!inner(status, verification_status, disabled_at, is_public)")
        .in("venue_id", venueIds)
        .eq("status", "posted")
        .eq("dancer_profiles.status", "approved")
        .eq("dancer_profiles.verification_status", "approved")
        .eq("dancer_profiles.is_public", true)
        .is("dancer_profiles.disabled_at", null)
        .is("checked_out_at", null)
        .or(`ends_at.gte.${now.toISOString()},location_verification_expires_at.gt.${now.toISOString()}`)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1)
        .abortSignal(controller.signal);
      if (error) throw error;
      shifts.push(...(data || []) as unknown as ActivityShift[]);
      if (!data || data.length < pageSize) break;
    }
    return countSavedVenueDancers(venueIds, shifts, now.getTime());
  } catch (error) {
    // Activity is optional: a failed count must not hide saved clubs or turn
    // unknown activity into a misleading zero.
    console.warn("CUSTOMER_VENUE_ACTIVITY_UNAVAILABLE", safeErrorMetadata(error));
    return new Map<string, SavedVenueActivity>();
  } finally {
    clearTimeout(timeout);
  }
}
