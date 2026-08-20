import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manager, packageJson, postbuild] = await Promise.all([
  readFile(new URL("../scripts/manage-demo-upcoming.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../scripts/manage-layout-review-postbuild.mjs", import.meta.url), "utf8"),
]);

test("the guarded production operation enforces six Now, two Upcoming, and two unscheduled dancers", () => {
  assert.match(manager, /const OPERATION_CONFIRMATION = "mydancr-six-now-two-unscheduled-v1"/);
  assert.match(manager, /const WORKING_NOW_COUNT = 6/);
  assert.match(manager, /const UPCOMING_COUNT = 2/);
  assert.match(manager, /const NO_SCHEDULE_COUNT = 2/);
  assert.match(manager, /target !== "production"/);
  assert.match(manager, /Production writes require --confirm=/);
  assert.match(packageJson, /"demo:upcoming": "node scripts\/manage-demo-upcoming\.mjs"/);
});

test("demo schedule maintenance is explicit and never runs during an ordinary production build", () => {
  assert.match(postbuild, /const upcomingSyncFlag = String\(process\.env\.DEMO_UPCOMING_SYNC \|\| ""\)\.trim\(\)/);
  assert.match(postbuild, /const DEFAULT_UPCOMING_SYNC_FLAG = "mydancr-three-upcoming-v1"/);
  assert.match(postbuild, /const shouldSyncUpcoming = Boolean\(upcomingSyncFlag\)/);
  assert.doesNotMatch(postbuild, /shouldSyncDefaultUpcoming/);
  assert.match(postbuild, /upcomingSyncFlag && upcomingSyncFlag !== DEFAULT_UPCOMING_SYNC_FLAG/);
  assert.match(postbuild, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(postbuild, /new URL\("\.\/manage-demo-upcoming\.mjs", import\.meta\.url\)/);
  assert.match(postbuild, /"--mode=apply"[\s\S]*?"--target=production"[\s\S]*?"--confirm=mydancr-six-now-two-unscheduled-v1"/);
  assert.match(postbuild, /populationFlag \|\| dealSyncFlag \|\| scheduleSyncFlag/);
  assert.match(postbuild, /if \(!populationFlag && !dealSyncFlag && !scheduleSyncFlag\) \{[\s\S]*?LAYOUT_REVIEW_POPULATION_SKIPPED/);
});

test("Upcoming assignments preserve exactly six Working Now dancers and leave two without schedules", () => {
  assert.match(manager, /loadWorkingNowDancerIds\(profileIds, now\)/);
  assert.match(manager, /workingNowIds\.size !== WORKING_NOW_COUNT/);
  assert.match(manager, /profiles\.filter\(\(profile\) => !workingNowIds\.has\(String\(profile\.id\)\)\)/);
  assert.match(manager, /slice\(0, UPCOMING_COUNT\)/);
  assert.match(manager, /noSchedule\.length !== NO_SCHEDULE_COUNT/);
  assert.match(manager, /peppermint-hippo-las-vegas/);
  assert.match(manager, /spearmint-rhino-las-vegas/);
  assert.match(manager, /Expected exactly \$\{UPCOMING_COUNT\} Upcoming demo dancers after verification/);
  assert.doesNotMatch(
    manager.match(/async function clearUpcomingAssignments[\s\S]*?async function assertMarkedDemoAccount/)?.[0] || "",
    /demo_locked|nfc_presence/,
  );
});

test("managed Upcoming shifts are future scheduled dates without a fake check-in or commission", () => {
  assert.match(manager, /shift_source: "scheduled"/);
  assert.match(manager, /checked_in_at: null/);
  assert.match(manager, /location_status: "self_reported"/);
  assert.match(manager, /location_verification_expires_at: null/);
  assert.match(manager, /commission_tracking_started_at: null/);
  assert.match(manager, /commission_tracking_stopped_at: null/);
  assert.match(manager, /demoUpcoming: true/);
  assert.match(manager, /managedBy: MANAGED_BY/);
  assert.match(manager, /await assertMarkedDemoAccount\(profile\)/);
});
