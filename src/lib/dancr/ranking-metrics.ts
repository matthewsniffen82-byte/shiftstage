import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSupabaseFunction } from "../supabase/missing-function.ts";

export type TrendingMetricCounts = {
  profileViews: number; scheduleViews: number; followers: number; favorites: number;
  directionRequests: number; goingSignals: number; notificationOpens: number; socialClicks: number;
};
const fields: (keyof TrendingMetricCounts)[] = ["profileViews", "scheduleViews", "followers", "favorites", "directionRequests", "goingSignals", "notificationOpens", "socialClicks"];

export async function getRankingMetricBatch(
  client: SupabaseClient, dancerIds: string[], since: Date,
  legacy: (id: string) => Promise<TrendingMetricCounts>,
) {
  const result = new Map<string, TrendingMetricCounts>();
  const ids = [...new Set(dancerIds)];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const response = await client.rpc("get_ranking_metric_batch", { p_dancer_ids: batch, p_since: since.toISOString() });
    if (response.error) {
      if (!isMissingSupabaseFunction(response.error, "get_ranking_metric_batch")) throw response.error;
      // Compatibility with older projects, with only two dancers in flight.
      for (let index = 0; index < batch.length; index += 2) {
        await Promise.all(batch.slice(index, index + 2).map(async id => result.set(id, await legacy(id))));
      }
      continue;
    }
    if (!Array.isArray(response.data)) throw new Error("Ranking metrics could not be verified.");
    for (const row of response.data) {
      if (!batch.includes(row.dancer_id) || !fields.every(field => Number.isFinite(row.metrics?.[field]) && row.metrics[field] >= 0)) {
        throw new Error("Ranking metrics could not be verified.");
      }
      result.set(row.dancer_id, row.metrics);
    }
    if (batch.some(id => !result.has(id))) throw new Error("Ranking metrics were incomplete. Please try again.");
  }
  return result;
}
