import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [manager, packageJson, postbuild] = await Promise.all([
  readFile(new URL("../scripts/manage-demo-upcoming.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../scripts/manage-layout-review-postbuild.mjs", import.meta.url), "utf8"),
]);

test("the guarded production operation enforces six Now, three Upcoming, and one unscheduled dancer", () => {
  assert.match(manager, /const OPERATION_CONFIRMATION = "mydancr-six-now-three-upcoming-random-venues-v1"/);
  assert.match(manager, /const WORKING_NOW_COUNT = 6/);
  assert.match(manager, /const UPCOMING_COUNT = 3/);
  assert.match(manager, /const NO_SCHEDULE_COUNT = 1/);
  assert.match(manager, /target !== "production"/);
  assert.match(manager, /Production writes require --confirm=/);
  assert.match(packageJson, /"demo:upcoming": "node scripts\/manage-demo-upcoming\.mjs"/);
});

test("demo schedule maintenance is explicit and never runs during an ordinary production build", () => {
  assert.match(postbuild, /const upcomingSyncFlag = String\(process\.env\.DEMO_UPCOMING_SYNC \|\| ""\)\.trim\(\)/);
  assert.match(postbuild, /const DEFAULT_UPCOMING_SYNC_FLAG = "mydancr-three-upcoming-random-venues-v1"/);
  assert.match(postbuild, /const shouldSyncUpcoming = Boolean\(upcomingSyncFlag\)/);
  assert.doesNotMatch(postbuild, /shouldSyncDefaultUpcoming/);
  assert.match(postbuild, /upcomingSyncFlag && upcomingSyncFlag !== DEFAULT_UPCOMING_SYNC_FLAG/);
  assert.match(postbuild, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(postbuild, /new URL\("\.\/manage-demo-upcoming\.mjs", import\.meta\.url\)/);
  assert.match(postbuild, /"--mode=apply"[\s\S]*?"--target=production"[\s\S]*?"--confirm=mydancr-six-now-three-upcoming-random-venues-v1"/);
  assert.match(postbuild, /populationFlag \|\| dealSyncFlag \|\| scheduleSyncFlag/);
  assert.match(postbuild, /if \(!populationFlag && !dealSyncFlag && !scheduleSyncFlag\) \{[\s\S]*?LAYOUT_REVIEW_POPULATION_SKIPPED/);
});

test("Upcoming assignments preserve exactly six Working Now dancers and leave one without a schedule", () => {
  assert.match(manager, /loadWorkingNowDancerIds\(profileIds, now\)/);
  assert.match(manager, /workingNowIds\.size !== WORKING_NOW_COUNT/);
  assert.match(manager, /profiles\.filter\(\(profile\) => !workingNowIds\.has\(String\(profile\.id\)\)\)/);
  assert.match(manager, /slice\(0, UPCOMING_COUNT\)/);
  assert.match(manager, /clearUpcomingAssignments\(profileIds, now\)/);
  assert.match(manager, /loadUpcomingAssignments\(profileIds, now\)/);
  assert.match(manager, /noSchedule\.length !== NO_SCHEDULE_COUNT/);
  assert.match(manager, /loadEligibleVenues\(\)/);
  assert.match(manager, /const selectedVenues = shuffled\(venues\)\.slice\(0, UPCOMING_COUNT\)/);
  assert.match(manager, /crypto\.randomInt\(index \+ 1\)/);
  assert.doesNotMatch(manager, /FEATURED_VENUE_SLUGS/);
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

function trimFixture() {
  const profiles = Array.from({ length: 10 }, (_, index) => ({ id: String(index), marked: true }));
  const rows = profiles.slice(6).map((profile, index) => ({
    id: `shift-${profile.id}`, dancer_id: profile.id, venue_id: `venue-${index}`,
    shift_date: `2026-09-${12 + index}`, starts_at: `2026-09-${12 + index}T07:01:00Z`,
    status: "posted", shift_source: "scheduled", checked_in_at: null, checked_out_at: null,
    shift_summary: { demoUpcoming: true, managedBy: "manage-demo-upcoming" },
  }));
  const fixture = { profiles, rows, workingNowIds: new Set(profiles.slice(0, 6).map((profile) => profile.id)), writes: 0, result: null, checkedAccounts: [] };
  const admin = {
    from(table) {
      assert.equal(table, "shifts");
      const predicates = [];
      let update;
      const query = {
        update(value) { update = value; return query; },
        in(key, values) { predicates.push((row) => values.includes(row[key])); return query; },
        eq(key, value) { predicates.push((row) => row[key] === value); return query; },
        is(key, value) { return query.eq(key, value); },
        contains(key, value) { predicates.push((row) => Object.entries(value).every(([field, expected]) => row[key]?.[field] === expected)); return query; },
        async select() {
          fixture.beforeUpdate?.();
          const matching = rows.filter((row) => predicates.every((predicate) => predicate(row)));
          fixture.writes += 1;
          matching.forEach((row) => Object.assign(row, update));
          return { data: matching.map(({ id }) => ({ id })), error: null };
        },
      };
      return query;
    },
  };
  const trimSource = manager.slice(manager.indexOf("async function trimAssignments()"), manager.indexOf("async function removeAssignments()"));
  fixture.run = vm.runInNewContext(`${trimSource}; trimAssignments`, {
    admin, WORKING_NOW_COUNT: 6, UPCOMING_COUNT: 3, NO_SCHEDULE_COUNT: 1,
    MANAGED_BY: "manage-demo-upcoming", target: "production",
    loadEligibleProfiles: async () => profiles,
    loadWorkingNowDancerIds: async () => fixture.workingNowIds,
    loadUpcomingAssignments: async () => rows.filter((row) => row.status === "posted"),
    assertMarkedDemoAccount: async (profile) => {
      fixture.checkedAccounts.push(profile.id);
      if (!profile.marked) throw new Error("Unmarked demo account");
    },
    isManagedUpcoming: (row) => row.shift_summary?.demoUpcoming === true && row.shift_summary?.managedBy === "manage-demo-upcoming",
    assertSuccess: (error) => { if (error) throw error; },
    publicAssignment: (row) => ({ id: row.id, shiftDate: row.shift_date, venueId: row.venue_id }),
    writeResult: (result) => { fixture.result = result; },
  });
  return fixture;
}

test("trimming preserves the three earliest dates and venues, cancels only the fourth, and is idempotent", async () => {
  const fixture = trimFixture();
  const before = structuredClone(fixture.rows);
  await fixture.run();
  assert.deepEqual(fixture.rows.slice(0, 3), before.slice(0, 3));
  assert.deepEqual(fixture.rows[3], { ...before[3], status: "cancelled" });
  assert.equal(fixture.checkedAccounts.length, 10);
  assert.equal(fixture.result.workingNowCount, 6);
  assert.equal(fixture.result.upcomingCount, 3);
  assert.equal(fixture.result.noScheduleCount, 1);
  assert.equal(fixture.result.cancelledCount, 1);
  await fixture.run();
  assert.equal(fixture.writes, 1);
  assert.equal(fixture.result.cancelledCount, 0);
});

test("trimming refuses unsafe demo states before making any changes", async () => {
  const scenarios = [
    (fixture) => { fixture.rows[3].shift_summary.demoUpcoming = false; },
    (fixture) => { fixture.rows[3].checked_in_at = new Date().toISOString(); },
    (fixture) => { fixture.profiles[9].marked = false; },
    (fixture) => { fixture.rows.splice(2); },
    (fixture) => { fixture.rows[3].dancer_id = fixture.rows[0].dancer_id; },
    (fixture) => { fixture.rows[3].dancer_id = "0"; },
    (fixture) => { fixture.workingNowIds.delete("0"); },
    (fixture) => { fixture.profiles.pop(); },
  ];
  for (const scenario of scenarios) {
    const fixture = trimFixture();
    scenario(fixture);
    const before = structuredClone(fixture.rows);
    await assert.rejects(fixture.run);
    assert.equal(fixture.writes, 0);
    assert.deepEqual(fixture.rows, before);
  }
});

test("trimming does not cancel a shift that checks in between inspection and the update", async () => {
  const fixture = trimFixture();
  fixture.beforeUpdate = () => { fixture.rows[3].checked_in_at = new Date().toISOString(); };
  await assert.rejects(fixture.run, /changed during trimming/);
  assert.equal(fixture.rows[3].status, "posted");
  assert.equal(fixture.result, null);
});
