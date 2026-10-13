import type { DancerPerformance } from "./venue-analytics";
import type { VenueDashboardAnalytics } from "./types";

export type DancerScorePeriod = VenueDashboardAnalytics["period"];
export type DancerScoreKey = "overall" | "checkIns" | "requests" | "profile";
export type DancerScoreSort = DancerScoreKey | "name";
export const DANCER_SCORE_VERSION = "1";
export const DANCER_SCORE_WEIGHTS = { checkIns: 15, requests: 45, profile: 40 } as const;
export const DANCER_SCORE_MIN_PEERS = 3;
export const DANCER_SCORE_MINIMUMS = {
  tonight: { hours: 1, requests: 3, claims: 3, actions: 10 },
  "7d": { hours: 2, requests: 5, claims: 5, actions: 20 },
  "30d": { hours: 4, requests: 10, claims: 10, actions: 30 },
  all: { hours: 4, requests: 10, claims: 10, actions: 30 },
} as const;

export type DancerScore = { value: number | null; reason: string | null };
export type ScoredDancer = {
  dancer: DancerPerformance;
  scores: Record<DancerScoreKey, DancerScore>;
  rank: number | null;
  rankedCount: number;
};

const actionWeights = { dancer_profile: 1, club_page: 2, directions: 3, going: 4, free_entry: 4, transport: 3 } as const;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
// SQL channel objects are sparse: omitted event types mean no recorded events.
const count = (value: unknown) => value === undefined ? 0 : finite(value);
const rounded = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
const available = (value: number): DancerScore => ({ value: rounded(value), reason: null });
const unavailable = (reason: string): DancerScore => ({ value: null, reason });

function medianPositive(values: number[]) {
  const positive = values.filter(value => value > 0).sort((a, b) => a - b);
  const middle = Math.floor(positive.length / 2);
  return positive.length ? positive.length % 2 ? positive[middle] : positive[middle - 1] / 2 + positive[middle] / 2 : 0;
}

// A typical positive value is 50, zero is zero, and outliers approach (not exceed) 100.
function relative(value: number, baseline: number) {
  return value > 0 && baseline > 0 ? 100 / (1 + baseline / value) : 0;
}

/** Input must be the complete authorized venue report for one selected period, before UI filtering. */
export function scoreVenueDancers(dancers: DancerPerformance[], period: DancerScorePeriod): ScoredDancer[] {
  const minimum = DANCER_SCORE_MINIMUMS[period];
  const inputs = dancers.map(dancer => {
    const hours = finite(dancer.internal.checkedInHours);
    const checkIns = finite(dancer.results?.checkIns);
    const received = count(dancer.internal.requests);
    const completed = finite(dancer.internal.completed);
    const duringHours = finite(dancer.internal.requestsDuringHours);
    const vip = count(dancer.vip.requests);
    const repeat = finite(dancer.vip.repeatRequesters);
    const claims = finite(dancer.results?.profileClaims);
    const cohort = finite(dancer.results?.profileCohortConversions);
    const redemptions = finite(dancer.results?.profileConversions);
    const actions = Object.entries(actionWeights).map(([key, weight]) => ({ count: count(dancer.external[key]), weight }));
    const actionCount = actions.every(action => action.count !== null) ? actions.reduce((sum, action) => sum + action.count!, 0) : null;
    const checkInEligible = hours !== null && hours >= minimum.hours && checkIns !== null;
    const tableEligible = hours !== null && hours >= minimum.hours && received !== null && received >= minimum.requests
      && completed !== null && completed <= received && duringHours !== null && duringHours <= received;
    const vipEligible = vip !== null && vip >= minimum.requests && repeat !== null && repeat <= vip;
    const profileEligible = claims !== null && claims >= minimum.claims && cohort !== null && cohort <= claims
      && redemptions !== null && actionCount !== null && Number.isFinite(actionCount) && actionCount >= minimum.actions;
    return { dancer, hours, checkIns, received, completed, vip, repeat, claims, cohort, redemptions, actionCount,
      checkInEligible, tableEligible, vipEligible, profileEligible,
      tableRate: tableEligible ? duringHours! / hours! : 0,
      redemptionRate: profileEligible ? redemptions! / actionCount! : 0,
      actionMix: profileEligible ? actions.reduce((sum, action) => sum + action.count! / actionCount! * action.weight / 4, 0) * 100 : 0,
    };
  });
  const checkInPeers = inputs.filter(row => row.checkInEligible);
  const tablePeers = inputs.filter(row => row.tableEligible);
  const vipPeers = inputs.filter(row => row.vipEligible);
  const profilePeers = inputs.filter(row => row.profileEligible);
  const baseline = {
    hours: medianPositive(checkInPeers.map(row => row.hours!)), checkIns: medianPositive(checkInPeers.map(row => row.checkIns!)),
    tableRate: medianPositive(tablePeers.map(row => row.tableRate)), vip: medianPositive(vipPeers.map(row => row.vip!)),
    repeat: medianPositive(vipPeers.map(row => row.repeat!)), redemptionRate: medianPositive(profilePeers.map(row => row.redemptionRate)),
  };
  const peerReason = `Needs ${DANCER_SCORE_MIN_PEERS} dancers with enough data in this club and period.`;
  const scored: ScoredDancer[] = inputs.map(row => {
    const checkIns = !row.checkInEligible ? unavailable(`Needs at least ${minimum.hours} verified hours and recorded check-in data.`)
      : checkInPeers.length < DANCER_SCORE_MIN_PEERS ? unavailable(peerReason)
        : available(0.35 * relative(row.checkIns!, baseline.checkIns) + 0.65 * relative(row.hours!, baseline.hours));
    const tableReady = row.tableEligible && tablePeers.length >= DANCER_SCORE_MIN_PEERS;
    const vipReady = row.vipEligible && vipPeers.length >= DANCER_SCORE_MIN_PEERS;
    const tableScore = tableReady ? 0.6 * row.completed! / row.received! * 100 + 0.4 * relative(row.tableRate, baseline.tableRate) : 0;
    const vipScore = vipReady ? 0.7 * relative(row.vip!, baseline.vip) + 0.3 * relative(row.repeat!, baseline.repeat) : 0;
    // Missing/low-sample channels never become zero. Overall weights are never redistributed.
    const requestWeight = (tableReady ? 0.7 : 0) + (vipReady ? 0.3 : 0);
    const requests = requestWeight ? available(((tableReady ? tableScore * 0.7 : 0) + (vipReady ? vipScore * 0.3 : 0)) / requestWeight)
      : unavailable(row.tableEligible || row.vipEligible ? peerReason : `Needs ${minimum.requests} table or VIP requests. Table scoring also needs ${minimum.hours} verified hours.`);
    const profile = !row.profileEligible ? unavailable(`Needs ${minimum.claims} profile pass claims and ${minimum.actions} recorded profile actions.`)
      : profilePeers.length < DANCER_SCORE_MIN_PEERS ? unavailable(peerReason)
        : available(0.6 * row.cohort! / row.claims! * 100 + 0.25 * relative(row.redemptionRate, baseline.redemptionRate) + 0.15 * row.actionMix);
    const overall = checkIns.value !== null && requests.value !== null && profile.value !== null
      ? available((checkIns.value * DANCER_SCORE_WEIGHTS.checkIns + requests.value * DANCER_SCORE_WEIGHTS.requests + profile.value * DANCER_SCORE_WEIGHTS.profile) / 100)
      : unavailable("All three category scores need enough data before an overall score or rank is assigned.");
    return { dancer: row.dancer, scores: { overall, checkIns, requests, profile }, rank: null, rankedCount: 0 };
  });
  const qualified = scored.filter(row => row.scores.overall.value !== null).sort((a, b) => b.scores.overall.value! - a.scores.overall.value!);
  // Competition ranks use displayed scores: ties share rank and never break on names.
  if (qualified.length >= DANCER_SCORE_MIN_PEERS) {
    let rank = 1;
    qualified.forEach((row, index) => {
      if (index && row.scores.overall.value !== qualified[index - 1].scores.overall.value) rank = index + 1;
      row.rank = rank;
    });
  }
  for (const row of scored) row.rankedCount = qualified.length >= DANCER_SCORE_MIN_PEERS ? qualified.length : 0;
  return scored;
}

export function sortScoredDancers(rows: ScoredDancer[], sort: DancerScoreSort): ScoredDancer[] {
  return [...rows].sort((a, b) => (sort === "name" ? 0 : (b.scores[sort].value ?? -1) - (a.scores[sort].value ?? -1))
    || a.dancer.name.localeCompare(b.dancer.name, "en", { sensitivity: "base", numeric: true }) || a.dancer.id.localeCompare(b.dancer.id));
}
