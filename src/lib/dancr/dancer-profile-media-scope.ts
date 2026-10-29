import { isActiveNfcPresence } from "./shift-presence";
import type { DancerProfile } from "./types";

// A club link keeps its explicit context. Ordinary profile links follow the
// current verified check-in, never a scheduled shift or an old affiliation.
export function dancerProfileMediaVenue(
  profile: Pick<DancerProfile, "upcomingShifts"> | null,
  requestedVenueId?: string | null,
  now = Date.now(),
): string | undefined {
  return requestedVenueId || profile?.upcomingShifts.find(shift => isActiveNfcPresence(shift, now))?.venueId || undefined;
}
