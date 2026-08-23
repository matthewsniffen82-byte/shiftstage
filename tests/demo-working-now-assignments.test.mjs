import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, manager, deals, discovery, publicService, types, shiftRoute, checkInRoute, shiftManager] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608120001_demo_locked_working_now.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/manage-demo-working-now.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerShiftManager.tsx", import.meta.url), "utf8"),
]);

test("Demo Mode has a distinct locked Working Now shift source", () => {
  assert.match(migration, /shift_source in \('scheduled', 'nfc_presence', 'demo_locked'\)/);
  assert.match(migration, /shifts_demo_locked_no_nfc_or_commission_check/);
  assert.match(migration, /commission_tracking_started_at is null/);
  assert.match(migration, /nfc_tag_id is null/);
});

test("the guarded production operation creates exactly six persistent randomized assignments", () => {
  assert.match(manager, /const OPERATION_CONFIRMATION = "mydancr-six-working-now-v1"/);
  assert.match(manager, /shuffled\(profiles\)\.slice\(0, 6\)/);
  assert.match(manager, /selectedVenues\[index % selectedVenues\.length\]/);
  assert.match(manager, /shift_source: "demo_locked"/);
  assert.match(manager, /location_verification_expires_at: LOCKED_UNTIL/);
  assert.match(manager, /commission_tracking_started_at: null/);
  assert.match(manager, /if \(\(data \|\| \[\]\)\.length !== 6\)/);
  assert.match(manager, /endExistingLasVegasWorkingNow\(now\)/);
  assert.match(manager, /publicWorkingNowCount: publicWorkingNow\.length/);
  assert.doesNotMatch(
    manager.match(/async function loadCurrentAssignments\(\)[\s\S]*?async function endCurrentDemoAssignments/)?.[0] || "",
    /neq\("shift_source", "demo_locked"\)/,
  );
  assert.match(
    manager.match(/async function endExistingLasVegasWorkingNow\(now\)[\s\S]*?function publicAssignment/)?.[0] || "",
    /neq\("shift_source", "demo_locked"\)/,
  );
});

test("locked demo assignments cannot create verified Club Deal attribution", () => {
  assert.match(deals, /\.neq\("shift_source", "demo_locked"\)/);
  assert.match(discovery, /const commissionEligible = dancer\.shiftSource !== "demo_locked"/);
  assert.match(publicService, /shiftSource: shift\?\.shift_source \|\| null/);
  assert.match(types, /"scheduled" \| "nfc_presence" \| "demo_locked" \| null/);
});

test("dancers cannot edit, end, or delete centrally managed demo assignments", () => {
  assert.match(shiftRoute, /existingShift\.shift_source === "demo_locked"/);
  assert.equal((checkInRoute.match(/shift\.shift_source === "demo_locked"/g) || []).length, 2);
  assert.match(checkInRoute, /demo_assignment_locked/);
  assert.match(shiftManager, /const demoManagedActiveShift = activeShift\?\.shift_source === "demo_locked"/);
  assert.match(shiftManager, /demoManagedActiveShift \? \([\s\S]*?Demo managed/);
  assert.match(shiftManager, /This fictional Demo Mode assignment is kept active automatically and cannot be ended from the dancer dashboard/);
});
