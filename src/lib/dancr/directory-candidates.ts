import type { SupabaseClient } from "@supabase/supabase-js";
import type { RankingCandidate } from "./discovery-ranking";
import { isAllMyDancrCities } from "./markets";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read only ranking identities and current presence, not photos or full cards.
// The database bounds each read; keep following the keyset until it is empty.
export async function getDirectoryCandidates(admin: SupabaseClient, city: string): Promise<RankingCandidate[]> {
  return getCandidates(admin, city, false);
}

export async function getTvRankingCandidates(admin: SupabaseClient, city: string, venueId?: string): Promise<RankingCandidate[]> {
  return getCandidates(admin, city, true, venueId);
}

async function getCandidates(admin: SupabaseClient, city: string, tv: boolean, venueId?: string): Promise<RankingCandidate[]> {
  const candidates: RankingCandidate[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error }: { data: unknown; error: unknown } = await admin.rpc(tv ? "get_public_tv_ranking_candidates" : "get_public_directory_candidates", {
      p_city: isAllMyDancrCities(city) ? "" : city, p_after: after,
      ...(tv ? { p_venue: venueId || null } : {}),
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Directory ranking could not be confirmed.");
    if (!data.length) return candidates;
    for (const row of data) {
      if (!row || !UUID.test(row.id) || after && row.id <= after || typeof row.city !== "string"
        || row.venueId != null && !UUID.test(row.venueId)
        || tv && !UUID.test(row.dancerId)) throw new Error("Invalid discovery ranking page.");
      after = row.id;
      candidates.push({ id: row.id, dancerId: tv ? row.dancerId : row.id, city: row.city, venueId: row.venueId,
        availableUntil: row.availableUntil, nextShiftAt: row.nextShiftAt || null, nextShiftEndsAt: row.nextShiftEndsAt || null,
        freshAt: row.freshAt || null, duration: row.duration || 0,
        buckets: Array.from({ length: 3 }, () => ({ impressions: 0, actions: 0, engaged: 0, completed: 0 })) });
    }
  }
}
