// Eligibility is checked before ranking. The only placement signal is the
// rolling 14-day Overall Performance score, using the venue dashboard's formula.
// Star's grid pin is a placement exception; it never changes scores or eligibility.
export type RankingSurface = "grid" | "tv";
export type RankingBucket = { impressions: number; actions: number; engaged: number; completed: number };
export type RankingCandidate = {
  id: string; dancerId: string; city: string; venueId: string | null;
  availableUntil: string | null; nextShiftAt: string | null; nextShiftEndsAt: string | null;
  freshAt: string | null; duration: number; buckets: RankingBucket[];
  performanceScore?: number | null;
};
export type RankingContext = { surface: RankingSurface; selectedId?: string };

export function pinStarInGrid<T extends { id: string }>(rows: readonly T[]): T[] {
  const index = rows.findIndex(row => row.id === "70e50bad-b7be-45ad-bc7a-64f1cba6b5e2");
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
  return context.surface === "grid" ? pinStarInGrid(ranked) : ranked;
}
