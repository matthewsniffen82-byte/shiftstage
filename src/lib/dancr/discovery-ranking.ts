// Pure ranking policy shared by the server and focused tests. Eligibility is
// enforced before candidates reach this module; scores never grant visibility.
export type RankingSurface = "grid" | "tv";
export type RankingBucket = { impressions: number; actions: number; engaged: number; completed: number };
export type RankingCandidate = {
  id: string; dancerId: string; city: string; venueId: string | null;
  availableUntil: string | null; nextShiftAt: string | null; nextShiftEndsAt: string | null;
  freshAt: string | null; duration: number; buckets: RankingBucket[];
  seenAt?: string | null; hidden?: boolean;
};
export type RankingContext = {
  surface: RankingSurface; now: number; seed: string;
  followingDancers?: readonly string[]; followingVenues?: readonly string[];
  selectedId?: string;
};
export const DISCOVERY_WEIGHTS = {
  grid: { availability: 35, engagement: 25, freshness: 20, relevance: 20, quality: 0 },
  tv: { availability: 20, engagement: 20, freshness: 20, relevance: 15, quality: 25 },
} as const;
const DAY = 86_400_000;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const count = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const time = (value: string | null | undefined) => value ? Date.parse(value) : NaN;
const total = (row: RankingCandidate, key: keyof RankingBucket) => row.buckets.reduce((n, bucket) => n + count(bucket[key]), 0);
export function rankingTie(seed: string, id: string) {
  let hash = 2166136261;
  for (const character of `${seed}:${id}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function availabilityBoost(row: RankingCandidate, now: number) {
  if (time(row.availableUntil) > now) return 1;
  const start = time(row.nextShiftAt), end = time(row.nextShiftEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > now) || start > now + 7 * DAY) return 0;
  return start <= now + DAY ? .6 : .3;
}
export function freshnessBoost(freshAt: string | null, now: number) {
  const age = now - time(freshAt);
  return age < 0 ? 0 : clamp(1 - age / (7 * DAY));
}
const durationBand = (seconds: number) => seconds <= 10 ? 0 : seconds <= 20 ? 1 : 2;

// Compare performance with the same placement band, and for viewing quality
// the same duration band. Shrink sparse samples toward their cohort baseline.
// Each viewer/day contributes at most one exposure and one action per item.
export function scoreDiscovery(candidates: readonly RankingCandidate[], context: RankingContext) {
  const weights = DISCOVERY_WEIGHTS[context.surface];
  const followed = new Set(context.followingDancers), venues = new Set(context.followingVenues);
  const cohorts = new Map<string, { impressions: number; successes: number }>();
  const cohortKey = (row: RankingCandidate, bucket: number, key: string) => JSON.stringify([row.city,bucket,key,key === "actions" ? "all" : durationBand(row.duration)]);
  for (const row of candidates) row.buckets.forEach((bucket,index) => {
    for (const key of ["actions","engaged","completed"] as const) {
      const id = cohortKey(row,index,key);
      const cohort = cohorts.get(id) || { impressions: 0, successes: 0 };
      cohort.impressions += count(bucket.impressions);
      cohort.successes += Math.min(count(bucket[key]),count(bucket.impressions));
      cohorts.set(id,cohort);
    }
  });
  const baseline = (row: RankingCandidate, bucket: number, key: "actions" | "engaged" | "completed") => {
    const { impressions, successes } = cohorts.get(cohortKey(row,bucket,key)) || { impressions: 0, successes: 0 };
    const prior = key === "actions" ? .08 : key === "engaged" ? .45 : .3;
    return (successes + 100 * prior) / (impressions + 100);
  };
  const rateScore = (row: RankingCandidate, key: "actions" | "engaged" | "completed") => {
    let sum = 0, mass = 0;
    row.buckets.forEach((bucket, index) => {
      const n = count(bucket.impressions), prior = baseline(row, index, key);
      if (!n) return;
      const smoothed = (Math.min(n, count(bucket[key])) + 50 * prior) / (n + 50);
      sum += clamp(smoothed / (smoothed + prior)) * n;
      mass += n;
    });
    return mass ? sum / mass : .5;
  };
  return candidates.filter(row => !row.hidden).map(row => {
    const availability = availabilityBoost(row, context.now);
    const freshness = freshnessBoost(row.freshAt, context.now);
    const relevance = followed.has(row.dancerId) ? 1 : row.venueId && venues.has(row.venueId) ? .75 : 0;
    const engagement = rateScore(row, "actions");
    const quality = .5 * rateScore(row, "engaged") + .5 * rateScore(row, "completed");
    const repeat = context.surface === "tv" && time(row.seenAt) > context.now - 7 * DAY ? .45 : 1;
    const score = repeat * (weights.availability * availability + weights.freshness * freshness
      + weights.relevance * relevance + weights.engagement * engagement + weights.quality * quality);
    const reasons = [availability === 1 ? "Verified working now" : availability ? "Upcoming shift" : "",
      freshness > 0 ? "Fresh approved media" : "", relevance ? "Matches your follows" : "",
      engagement > .55 ? "Strong visitor interest" : "", context.surface === "tv" && quality > .55 ? "Engaging video" : ""].filter(Boolean);
    return { ...row, score, reasons, exposures: total(row, "impressions") };
  });
}

export function rankDiscovery(candidates: readonly RankingCandidate[], context: RankingContext) {
  const ranked = scoreDiscovery(candidates, context);
  const ties = new Map(ranked.map(row => [row.id,rankingTie(context.seed,row.id)]));
  const tie = (a: typeof ranked[number], b: typeof ranked[number]) => ties.get(a.id)!-ties.get(b.id)! || a.id.localeCompare(b.id);
  const compare = (a: typeof ranked[number], b: typeof ranked[number]) => b.score - a.score
    || tie(a,b);
  const pool = [...ranked].sort(compare), result: typeof ranked = [];
  const firstDancers = new Set<string>();
  const explorationOrder = [...ranked].sort((a,b)=>a.exposures-b.exposures || tie(a,b));
  const exposureFloor = explorationOrder[Math.floor(ranked.length * .25)]?.exposures ?? 0;
  const used = new Set<string>();
  while (pool.length) {
    const blocked = context.surface !== "tv" ? new Set<string>() : result.length < 6
      ? firstDancers : new Set(result.slice(-3).map(row=>row.dancerId));
    let allowed = (row: typeof ranked[number]) => !blocked.has(row.dancerId);
    let selected = pool.find(allowed);
    if (!selected) {
      allowed = row => context.surface !== "tv" || row.dancerId !== result.at(-1)?.dancerId;
      selected = pool.find(allowed) || pool[0];
    }
    // One in five slots is an exploration opportunity, never a visibility bypass.
    if (result.length % 5 === 4) {
      const exploration = explorationOrder.find(row => !used.has(row.id) && allowed(row) && row.exposures<=exposureFloor && !row.seenAt);
      if (exploration) selected = exploration;
    }
    if (!result.length && context.selectedId) selected = pool.find(row => row.id === context.selectedId) || selected;
    result.push(selected);
    used.add(selected.id);
    firstDancers.add(selected.dancerId);
    pool.splice(pool.findIndex(row => row.id === selected.id), 1);
  }
  return result;
}
