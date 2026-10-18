// Eligibility is checked before ranking. The only placement signal is the
// rolling 14-day Overall Performance score, using the venue dashboard's formula.
export type RankingSurface = "grid" | "tv";
export type RankingBucket = { impressions: number; actions: number; engaged: number; completed: number };
export type RankingCandidate = {
  id: string; dancerId: string; city: string; venueId: string | null;
  availableUntil: string | null; nextShiftAt: string | null; nextShiftEndsAt: string | null;
  freshAt: string | null; duration: number; buckets: RankingBucket[];
  performanceScore?: number | null;
};
export type RankingContext = { surface: RankingSurface; selectedId?: string };

export function rankDiscovery(candidates: readonly RankingCandidate[], context: RankingContext) {
  const score = (row: RankingCandidate) => typeof row.performanceScore === "number" && Number.isFinite(row.performanceScore)
    && row.performanceScore >= 0 ? row.performanceScore : -1;
  return [...candidates].sort((a, b) => {
    // A direct video link still opens the video the visitor selected.
    if (context.surface === "tv" && context.selectedId) {
      if (a.id === context.selectedId) return -1;
      if (b.id === context.selectedId) return 1;
    }
    return score(b) - score(a) || a.dancerId.localeCompare(b.dancerId) || a.id.localeCompare(b.id);
  });
}
