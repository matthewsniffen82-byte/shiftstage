import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerPerformance } from "./venue-analytics";
import type { DancerPlacementScorecard } from "./dancer-analytics-types";
import { DANCER_PLACEMENT_DAYS, DANCER_PLACEMENT_PERIOD, DANCER_SCORE_VERSION, scoreVenueDancers } from "./venue-dancer-scores";

export const PLACEMENT_PERIOD = DANCER_PLACEMENT_PERIOD;
export const PLACEMENT_VERSION = `performance-${DANCER_SCORE_VERSION}-${PLACEMENT_PERIOD}`;
type Identity = { dancerId: string; venueId?: string | null };
const DAY = 86_400_000;
// Cache only calculated score summaries, never names or the raw report. Concurrent public
// requests share one report per club; a new visit sees updates within a minute.
const scoreCache = new Map<string, { expires: number; scores: Promise<Map<string, DancerPlacementScorecard>> }>();

function venueScores(admin: SupabaseClient, venueId: string, now: number) {
  const key = `${PLACEMENT_VERSION}:${venueId}`;
  const cached = scoreCache.get(key);
  if (cached && cached.expires > now) return cached.scores;
  const periodStart = new Date(now - DANCER_PLACEMENT_DAYS * DAY).toISOString();
  const scores = (async () => {
    const { data, error } = await admin.rpc("get_venue_performance_analytics", {
      p_venue_id: venueId,
      p_since: periodStart,
      p_until: new Date(now).toISOString(),
      p_tonight_since: new Date(now - DAY).toISOString(),
      p_tonight_until: new Date(now).toISOString(),
    });
    if (error) throw error;
    if (!Array.isArray(data?.performance?.dancers)) throw new Error("Dancer performance could not be confirmed.");
    // Score the full cohort, exactly as the venue dashboard does, before
    // applying public eligibility, filters or pagination.
    return new Map(scoreVenueDancers(data.performance.dancers as DancerPerformance[], PLACEMENT_PERIOD)
      .map(row => [row.dancer.id, { venueId, periodStart, periodEnd: new Date(now).toISOString(),
        scores: Object.fromEntries(Object.entries(row.scores).map(([key, score]) => [key,
          { value: score.value, reason: score.reason, confidence: score.confidence, evidence: score.evidence }])) as DancerPlacementScorecard["scores"],
      }]));
  })();
  const entry = { expires: now + 60_000, scores };
  scoreCache.delete(key);
  scoreCache.set(key, entry);
  if (scoreCache.size > 256) scoreCache.delete(scoreCache.keys().next().value!);
  void scores.catch(() => { if (scoreCache.get(key) === entry) scoreCache.delete(key); });
  return scores;
}

// Only authenticated owner routes may return these summaries to clients.
export async function getPerformancePlacementScorecards(admin: SupabaseClient, identities: readonly Identity[], now = Date.now()) {
  const venues = identities.map(row => row.venueId || null);
  const missing = [...new Set(identities.filter(row => !row.venueId).map(row => row.dancerId))];
  const affiliations = new Map<string, string>();
  for (let start = 0; start < missing.length; start += 200) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from("venue_dancer_affiliations").select("id,dancer_id,venue_id,approved_at")
        .in("dancer_id", missing.slice(start, start + 200)).eq("status", "active")
        .order("approved_at", { ascending: false, nullsFirst: false }).order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw error;
      for (const row of data || []) if (!affiliations.has(row.dancer_id)) affiliations.set(row.dancer_id, row.venue_id);
      if ((data || []).length < 1000) break;
    }
  }
  identities.forEach((row, index) => { venues[index] ||= affiliations.get(row.dancerId) || null; });
  const clubIds = [...new Set(venues.filter((id): id is string => Boolean(id)))];
  const reports = new Map<string, Map<string, DancerPlacementScorecard>>();
  // Bound database concurrency even for all-city grids.
  for (let start = 0; start < clubIds.length; start += 4) {
    await Promise.all(clubIds.slice(start, start + 4).map(async id => reports.set(id, await venueScores(admin, id, now))));
  }
  return identities.map((row, index) => {
    const venue = venues[index];
    return venue ? reports.get(venue)?.get(row.dancerId) ?? null : null;
  });
}

export async function getPerformancePlacementScores(admin: SupabaseClient, identities: readonly Identity[], now = Date.now()) {
  return (await getPerformancePlacementScorecards(admin, identities, now)).map(card => card?.scores.overall.value ?? null);
}

export async function orderByPerformance<T>(admin: SupabaseClient, rows: readonly T[], identity: (row: T) => Identity, id: (row: T) => string) {
  const scores = await getPerformancePlacementScores(admin, rows.map(identity));
  return rows.map((row, index) => ({ row, score: scores[index] ?? -1 }))
    .sort((a, b) => b.score - a.score || id(a.row).localeCompare(id(b.row)))
    .map(entry => entry.row);
}
