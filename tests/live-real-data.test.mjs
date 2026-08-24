import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [legacySource, publicSource, typesSource, goingRouteSource, shiftLifecycleSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/going/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/shift-lifecycle.ts", import.meta.url), "utf8"),
]);

test("public live cards expose the exact database going count for their selected shift", () => {
  assert.match(typesSource, /goingCount\?: number/);
  assert.match(publicSource, /async function countShiftGoingSignals/);
  assert.match(publicSource, /\.from\("going_signals"\)[\s\S]*?\.eq\("shift_id", shiftId\)/);
  assert.match(publicSource, /countShiftGoingSignals\(client, shift\?\.id \|\| null\)/);
  assert.match(publicSource, /goingCount,/);
});

test("the live profile never manufactures engagement or ranking values", () => {
  assert.doesNotMatch(legacySource, /function seededRange/);
  assert.doesNotMatch(legacySource, /seededRange\(/);
  assert.doesNotMatch(legacySource, /status\.state === "active" \? 36/);
  assert.doesNotMatch(legacySource, /currentRank \|\| index \+ 1/);
  assert.match(legacySource, /goingCount: item\.goingCount \?\? item\.going_count \?\? 0/);
  assert.match(legacySource, /metricPhraseMarkup\(`\$\{tonightInterestCount\(profile\)\.toLocaleString\(\)\} people going`\)/);
});

test("going actions update immediately, then reconcile to the persisted API count or roll back", () => {
  assert.match(goingRouteSource, /const goingCount = await countShiftGoingSignals\(admin, shiftId\)/);
  assert.match(goingRouteSource, /\{ ok: true, going, goingCount, anonymous: !identity\.customerId \}/);
  assert.match(legacySource, /const data = await postOptionalAuthJson\("\/api\/customer\/going"/);
  assert.match(legacySource, /const optimisticCount = Math\.max\(0, previousCount \+ \(requestedGoing \? 1 : -1\)\)/);
  assert.match(legacySource, /const realCount = Number\(data\.goingCount\)/);
  assert.match(legacySource, /if \(!Number\.isSafeInteger\(realCount\) \|\| realCount < 0\)/);
  assert.match(legacySource, /catch \(error\) \{[\s\S]*profile\.goingCount = previousCount/);
});

test("discovery begins empty and only production venue results populate it", () => {
  assert.doesNotMatch(legacySource, /Azure Room|Midnight Palm|Peachtree Room|Mercer Night/);
  assert.match(legacySource, /"Las Vegas": \{[\s\S]*?stats: \{ dancers: 0, shifts: 0, venues: 0 \},[\s\S]*?venues: \[\]/);
  assert.match(legacySource, /market\.dancers = liveDancers/);
  assert.match(legacySource, /market\.venues = dedupePublicVenues\(\[\.\.\.liveVenues, \.\.\.privatePreviewVenues\]\)/);
  assert.match(legacySource, /privatePreviewVenues = venuePreviewRequested\(\)[\s\S]*?isDashboardPreview === true/);
  assert.match(legacySource, /function dedupePublicVenues\(venues\)/);
  assert.match(legacySource, /markets\[city\]\.dancers = \[\]/);
});

test("completed shift summaries use persisted production event tables", () => {
  assert.match(shiftLifecycleSource, /async function buildShiftSummary/);
  assert.match(shiftLifecycleSource, /countMetricRows\(client, "profile_views"/);
  assert.match(shiftLifecycleSource, /countMetricRows\(client, "qr_redemptions"/);
  assert.match(shiftLifecycleSource, /countMetricRows\(client, "follows"/);
  assert.match(shiftLifecycleSource, /\.from\("commission_events"\)/);
  assert.match(shiftLifecycleSource, /shift_summary: shiftSummary/);
  assert.doesNotMatch(legacySource, /shift-summary-views|shift-summary-scans|shift-summary-followers/);
});
