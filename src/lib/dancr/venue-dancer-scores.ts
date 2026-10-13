import type { DancerPerformance } from "./venue-analytics";
import type { VenueDashboardAnalytics } from "./types";

export type DancerScorePeriod = VenueDashboardAnalytics["period"];
export const DANCER_SCORE_LABELS = {
  overall: "Overall Performance", checkIns: "Check-in Activity", internal: "Internal Table Requests",
  vip: "VIP Requests", profile: "Profile Interest", conversions: "Verified Entry Conversions",
} as const;
export const DANCER_SCORE_CATEGORIES = ["checkIns", "internal", "vip", "profile", "conversions"] as const;
export type DancerScoreCategory = typeof DANCER_SCORE_CATEGORIES[number];
export type DancerScoreKey = "overall" | DancerScoreCategory;
export type DancerScoreSort = DancerScoreKey | "name";
export const DANCER_SCORE_VERSION = "4";
export const DANCER_SCORE_WEIGHTS = { checkIns: 15, internal: 25, vip: 20, profile: 10, conversions: 30 } as const;
export const CHECK_IN_SCORE_WEIGHTS = { accuracy: 50, days: 25, hours: 25 } as const;
export const BOTH_ROSTER_ACTIVITY_BOOST = 0.25;
export const DANCER_SCORE_MIN_PEERS = 3;
export const DANCER_SCORE_MINIMUMS = {
  tonight: { hours: 1, requests: 3, claims: 3, actions: 10 },
  "7d": { hours: 2, requests: 5, claims: 5, actions: 20 },
  "30d": { hours: 4, requests: 10, claims: 10, actions: 30 },
  all: { hours: 4, requests: 10, claims: 10, actions: 30 },
} as const;

export type DancerScore = {
  value: number | null;
  reason: string | null;
  confidence: "early" | "established" | null;
  evidence: string;
};
export type ScoredDancer = {
  dancer: DancerPerformance;
  scores: Record<DancerScoreKey, DancerScore>;
  rank: number | null;
  rankedCount: number;
};

// Only events explicitly attributed to both the dancer and this venue.
const interestWeights = { dancer_profile: 1, club_page: 2, directions: 3, going: 3, free_entry: 3, transport: 3, follow: 2, share_completed: 2 } as const;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const count = (value: unknown) => value === undefined ? 0 : finite(value);
const wholeCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const rounded = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
const available = (value: number, early: boolean, evidence: string): DancerScore => ({ value: rounded(value), reason: null, confidence: early ? "early" : "established", evidence });
const unavailable = (reason: string): DancerScore => ({ value: null, reason, confidence: null, evidence: "" });
const display = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

function medianPositive(values: number[]) {
  const positive = values.filter(value => value > 0).sort((a, b) => a - b);
  const middle = Math.floor(positive.length / 2);
  return positive.length ? positive.length % 2 ? positive[middle] : positive[middle - 1] / 2 + positive[middle] / 2 : 0;
}
function relative(value: number, baseline: number) {
  return value > 0 && baseline > 0 ? 100 / (1 + baseline / value) : 0;
}

/** Score the complete authorized venue/period report before search, sort or pagination. */
export function scoreVenueDancers(dancers: DancerPerformance[], period: DancerScorePeriod): ScoredDancer[] {
  const minimum = DANCER_SCORE_MINIMUMS[period];
  const inputs = dancers.map(dancer => {
    const hours = finite(dancer.internal.checkedInHours);
    const rosterHours = finite(dancer.internal.rosterTrackedHours);
    // Older reports have no mode history. They keep their base score, without an invented bonus.
    const bothHours = count(dancer.internal.rosterBothHours);
    const checkInDays = wholeCount(dancer.internal.verifiedCheckInDays);
    const checkoutDays = wholeCount(dancer.internal.checkoutEligibleDays);
    const accurateDays = wholeCount(dancer.internal.dancerCheckoutDays);
    const activeDays = wholeCount(dancer.internal.activeCheckInDays);
    const received = count(dancer.internal.requests);
    const duringHours = finite(dancer.internal.requestsDuringHours);
    // Excludes customer withdrawals; staff booking decisions do not affect these aggregates.
    const vip = finite(dancer.vip.scoringRequests);
    const vipCustomers = finite(dancer.vip.scoringUniqueRequesters);
    const repeat = finite(dancer.vip.scoringRepeatRequesters);
    const claims = finite(dancer.results?.profileClaims);
    const cohort = finite(dancer.results?.profileCohortConversions);
    const actions = Object.entries(interestWeights).map(([key, weight]) => ({ count: count(dancer.external[key]), weight }));
    const actionCount = actions.every(action => action.count !== null) ? actions.reduce((sum, action) => sum + action.count!, 0) : null;
    const interest = actionCount !== null ? actions.reduce((sum, action) => sum + action.count! * action.weight, 0) : null;
    const checkInEligible = rosterHours !== null && rosterHours >= minimum.hours && bothHours !== null && bothHours <= rosterHours
      && checkInDays !== null && checkInDays > 0
      && checkoutDays !== null && checkoutDays <= checkInDays && accurateDays !== null && accurateDays <= checkoutDays
      && activeDays !== null && activeDays <= checkInDays;
    const tableRate = hours && duringHours !== null ? duringHours / hours : null;
    const tableEligible = hours !== null && hours >= minimum.hours && received !== null && duringHours !== null && duringHours >= minimum.requests
      && duringHours <= received && tableRate !== null && Number.isFinite(tableRate);
    const vipEligible = vip !== null && vip >= minimum.requests && vipCustomers !== null && vipCustomers > 0
      && vipCustomers <= vip && repeat !== null && repeat <= vipCustomers;
    const profileEligible = actionCount !== null && Number.isFinite(actionCount) && actionCount >= minimum.actions
      && interest !== null && Number.isFinite(interest);
    const conversionEligible = claims !== null && claims >= minimum.claims && cohort !== null && cohort <= claims;
    return { dancer, hours, rosterHours, bothHours, checkInDays, checkoutDays, accurateDays, activeDays, duringHours, tableRate, vip, vipCustomers, repeat, claims, cohort, actionCount, interest,
      checkInEligible, tableEligible, vipEligible, profileEligible, conversionEligible };
  });
  const checkInPeers = inputs.filter(row => row.checkInEligible);
  const tablePeers = inputs.filter(row => row.tableEligible);
  const vipPeers = inputs.filter(row => row.vipEligible);
  const profilePeers = inputs.filter(row => row.profileEligible);
  const baseline = {
    hours: medianPositive(checkInPeers.map(row => row.rosterHours!)), days: medianPositive(checkInPeers.map(row => row.checkInDays!)),
    tableRate: medianPositive(tablePeers.map(row => row.tableRate!)),
    vip: medianPositive(vipPeers.map(row => row.vip!)), interest: medianPositive(profilePeers.map(row => row.interest!)),
  };
  const peerReason = `Needs ${DANCER_SCORE_MIN_PEERS} dancers with enough data in this club and period.`;
  const scored: ScoredDancer[] = inputs.map(row => {
    const activityWeight = CHECK_IN_SCORE_WEIGHTS.days + CHECK_IN_SCORE_WEIGHTS.hours;
    const activityMultiplier = row.checkInEligible ? 1 + BOTH_ROSTER_ACTIVITY_BOOST * row.bothHours! / row.rosterHours! : 1;
    const attendancePoints = row.checkInEligible ? Math.min(activityWeight * 100,
      (CHECK_IN_SCORE_WEIGHTS.days * relative(row.checkInDays!, baseline.days)
        + CHECK_IN_SCORE_WEIGHTS.hours * relative(row.rosterHours!, baseline.hours)) * activityMultiplier) : 0;
    // An active first visit has no checkout opportunity yet. Show a provisional activity score without assuming success or failure.
    const checkInValue = row.checkoutDays! > 0
      ? (attendancePoints + CHECK_IN_SCORE_WEIGHTS.accuracy * 100 * row.accurateDays! / row.checkoutDays!) / 100
      : attendancePoints / activityWeight;
    const checkIns = !row.checkInEligible ? unavailable(`Needs at least ${minimum.hours} hours with verified dancer check-in and checkout tracking.`)
      : checkInPeers.length < DANCER_SCORE_MIN_PEERS ? unavailable(peerReason)
        : available(checkInValue, row.rosterHours! < minimum.hours * 2 || row.checkoutDays! < 3,
          `${display(row.checkInDays!)} check-in ${row.checkInDays === 1 ? "day" : "days"} · ${row.checkoutDays! > 0 ? `Dancer checkout: ${display(row.accurateDays!)}/${display(row.checkoutDays!)} ended days` : "Checkout accuracy pending"} · ${display(row.rosterHours!)}h tracked · ${display(row.bothHours!)}h on both rosters${row.activeDays! > 0 ? ` · ${display(row.activeDays!)} active ${row.activeDays === 1 ? "day" : "days"}` : ""}`);
    const internal = !row.tableEligible ? unavailable(`Needs ${minimum.requests} requests during at least ${minimum.hours} recorded checked-in hours.`)
      : tablePeers.length < DANCER_SCORE_MIN_PEERS ? unavailable(peerReason)
        : available(relative(row.tableRate!, baseline.tableRate), row.duringHours! < Math.max(20, minimum.requests * 2), `${display(row.duringHours!)} requests · ${display(row.tableRate!)} / hr`);
    const vip = !row.vipEligible ? unavailable(`Needs ${minimum.requests} VIP selections with customer-withdrawal tracking.`)
      : vipPeers.length < DANCER_SCORE_MIN_PEERS ? unavailable(peerReason)
        : available(0.8 * relative(row.vip!, baseline.vip) + 20 * row.repeat! / row.vipCustomers!, row.vip! < Math.max(20, minimum.requests * 2), `${display(row.vip!)} selections · ${display(row.vipCustomers!)} customers · ${display(row.repeat!)} returning`);
    const profile = !row.profileEligible ? unavailable(`Needs ${minimum.actions} recorded profile-interest actions.`)
      : profilePeers.length < DANCER_SCORE_MIN_PEERS ? unavailable(peerReason)
        : available(relative(row.interest!, baseline.interest), row.actionCount! < minimum.actions * 2, `${display(row.actionCount!)} attributed actions`);
    // A single claim cohort is the denominator; unrelated clicks never dilute entry results.
    const conversions = !row.conversionEligible ? unavailable(`Needs ${minimum.claims} profile pass claims with redemption tracking.`)
      : available(100 * row.cohort! / row.claims!, row.claims! < Math.max(20, minimum.claims * 2), `${display(row.cohort!)} of ${display(row.claims!)} claimed passes redeemed`);
    const categories = { checkIns, internal, vip, profile, conversions };
    const eligible = DANCER_SCORE_CATEGORIES.filter(key => categories[key].value !== null);
    const weight = eligible.reduce((sum, key) => sum + DANCER_SCORE_WEIGHTS[key], 0);
    const overall = eligible.length < 3 ? unavailable("Needs at least three category scores. Missing categories are never counted as zero.")
      : available(eligible.reduce((sum, key) => sum + categories[key].value! * DANCER_SCORE_WEIGHTS[key], 0) / weight,
        eligible.length < 5 || eligible.some(key => categories[key].confidence === "early"), `${eligible.length} of 5 categories`);
    return { dancer: row.dancer, scores: { overall, ...categories }, rank: null, rankedCount: 0 };
  });
  // Partial and early scores are useful summaries, but not comparable enough to rank.
  const qualified = scored.filter(row => row.scores.overall.confidence === "established").sort((a, b) => b.scores.overall.value! - a.scores.overall.value!);
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
