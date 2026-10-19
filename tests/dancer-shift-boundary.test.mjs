import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shiftRoute, shiftLifecycle, dancerService, checkInRoute, visibilityRoute] = await Promise.all([
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/shift-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/visibility/route.ts", import.meta.url), "utf8"),
]);

test("retired scheduling cannot write shifts; checkout and visibility use their guarded services", () => {
  for (const method of ["POST", "PATCH", "DELETE"]) assert.ok(shiftRoute.includes(`export const ${method} = retiredSchedule`));
  assert.match(shiftRoute, /status: 410/);
  assert.doesNotMatch(shiftRoute, /\.from\("shifts"\)[\s\S]*?\.(insert|update|delete|upsert)\(/);
  assert.match(checkInRoute, /endDancerShift/);
  assert.match(visibilityRoute, /rpc\("enable_dancer_shift_both"/);
  assert.match(visibilityRoute, /p_dancer_user_id: user\.id/);
  assert.doesNotMatch(visibilityRoute, /\.from\("shifts"\)/);
});

test("the shift lifecycle fixes creation state and scopes every edit to its dancer", () => {
  const createWriter = shiftLifecycle.match(/export async function createScheduledDancerShift[\s\S]*?\n}/)?.[0] || "";
  const updateWriter = shiftLifecycle.match(/export async function updateOwnedDancerShift[\s\S]*?\n}/)?.[0] || "";

  assert.match(createWriter, /shift_source: "scheduled"/);
  assert.match(createWriter, /status: "posted"/);
  assert.match(updateWriter, /DANCER_SHIFT_UPDATE_FIELDS/);
  assert.match(updateWriter, /\.eq\("id", shiftId\)[\s\S]*?\.eq\("dancer_id", dancerId\)/);
  assert.match(updateWriter, /\.neq\("shift_source", "demo_locked"\)/);
  assert.match(updateWriter, /\.or\("checked_in_at.is.null,checked_out_at.not.is.null"\)/);
  assert.match(updateWriter, /Dancer shift update was not applied/);
});

test("unsafe legacy shift writers are removed from the general dancer service", () => {
  assert.doesNotMatch(dancerService, /export type ShiftInput/);
  assert.doesNotMatch(dancerService, /export async function postShift/);
  assert.doesNotMatch(dancerService, /export async function updateShift/);
  assert.doesNotMatch(dancerService, /export async function cancelShift/);
  assert.doesNotMatch(dancerService, /\.from\("shifts"\)[\s\S]*?\.(insert|update|delete|upsert)\(/);
});
