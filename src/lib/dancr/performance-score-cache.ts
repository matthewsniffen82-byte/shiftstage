import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerPlacementScorecard } from "./dancer-analytics-types";

function transientCacheFailure(error: { code?: string } | null) {
  return error && ["SUPABASE_UNAVAILABLE", "57014", "53300", "08006", "PGRST000", "PGRST001", "PGRST002"].includes(error.code || "");
}

export async function readPerformanceScoreCache(admin: SupabaseClient, venueId: string, version: string, now: number) {
  const { data, error } = await admin.from("venue_performance_score_cache").select("computed_at,scores")
    .eq("venue_id", venueId).eq("score_version", version).maybeSingle();
  if (error) {
    if (!transientCacheFailure(error)) throw error;
    console.warn("Performance score cache read unavailable", { code: error.code });
    return null;
  }
  if (!data) return null;
  const computedAt = Date.parse(data.computed_at);
  if (!Number.isFinite(computedAt) || computedAt > now || computedAt + 60_000 <= now) return null;
  if (!Array.isArray(data.scores) || data.scores.some(row => !Array.isArray(row) || row.length !== 2
    || typeof row[0] !== "string" || row[1]?.venueId !== venueId || !row[1]?.scores)) {
    throw new Error("Stored performance scores could not be confirmed.");
  }
  return { computedAt, scores: new Map<string, DancerPlacementScorecard>(data.scores) };
}

export async function storePerformanceScoreCache(admin: SupabaseClient, venueId: string, version: string,
  computedAt: number, scores: Map<string, DancerPlacementScorecard>) {
  const { error } = await admin.rpc("store_venue_performance_scores", {
    p_venue_id: venueId, p_version: version, p_computed_at: new Date(computedAt).toISOString(), p_scores: [...scores],
  });
  if (error) {
    if (!transientCacheFailure(error)) throw error;
    // The fresh full-cohort result is still valid. Do not repeat this write or
    // turn an optional cache outage into a public discovery outage.
    console.warn("Performance score cache write unavailable", { code: error.code });
  }
}
