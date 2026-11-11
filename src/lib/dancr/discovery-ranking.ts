// Eligibility is checked before ranking. The only placement signal is the
// rolling Overall Performance score, using the venue dashboard's formula.
// Grid pins only change placement among eligible profiles.
export type RankingSurface = "grid" | "tv";
export type RankingBucket = { impressions: number; actions: number; engaged: number; completed: number };
export type RankingCandidate = {
  id: string; dancerId: string; city: string; venueId: string | null;
  availableUntil: string | null; nextShiftAt: string | null; nextShiftEndsAt: string | null;
  freshAt: string | null; duration: number; buckets: RankingBucket[];
  performanceScore?: number | null;
};
export type RankingContext = { surface: RankingSurface; selectedId?: string; workingNow?: boolean };

const STAR_PROFILE_ID = "70e50bad-b7be-45ad-bc7a-64f1cba6b5e2";
const DEMO_PROFILE_ID = "08f67659-7e7c-4c15-a97b-7831051e7ef2";

export function pinGridProfile<T extends { id: string }>(rows: readonly T[], profileId = STAR_PROFILE_ID): T[] {
  const index = rows.findIndex(row => row.id === profileId);
  if (index <= 0) return [...rows];
  return [rows[index], ...rows.slice(0, index), ...rows.slice(index + 1)];
}

export function rankDiscovery(candidates: readonly RankingCandidate[], context: RankingContext) {
  const score = (row: RankingCandidate) => typeof row.performanceScore === "number" && Number.isFinite(row.performanceScore)
    && row.performanceScore >= 0 ? row.performanceScore : -1;
  const ranked = [...candidates].sort((a, b) => {
    // A direct video link still opens the video the visitor selected.
    if (context.surface === "tv" && context.selectedId) {
      if (a.id === context.selectedId) return -1;
      if (b.id === context.selectedId) return 1;
    }
    return score(b) - score(a) || a.dancerId.localeCompare(b.dancerId) || a.id.localeCompare(b.id);
  });
  if (context.surface !== "grid") return ranked;
  const grid = pinGridProfile(ranked);
  return context.workingNow ? pinGridProfile(grid, DEMO_PROFILE_ID) : grid;
}
