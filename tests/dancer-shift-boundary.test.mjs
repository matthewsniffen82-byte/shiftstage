import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shiftRoute, shiftLifecycle, dancerService, checkInRoute] = await Promise.all([
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/shift-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
]);

test("all production dancer shift mutations use one lifecycle service", () => {
  const postHandler = shiftRoute.match(/export async function POST[\s\S]*?(?=\nexport async function PATCH)/)?.[0] || "";
  const patchHandler = shiftRoute.match(/export async function PATCH[\s\S]*?(?=\nasync function getOwnShift)/)?.[0] || "";

  assert.match(shiftRoute, /createScheduledDancerShift/);
  assert.match(shiftRoute, /recordDancerShiftBroadcast/);
  assert.match(shiftRoute, /updateOwnedDancerShift/);
  assert.doesNotMatch(postHandler, /\.from\("shifts"\)[\s\S]*?\.(insert|update|delete|upsert)\(/);
  assert.doesNotMatch(patchHandler, /\.from\("shifts"\)[\s\S]*?\.(insert|update|delete|upsert)\(/);
  assert.match(checkInRoute, /endDancerShift/);
});

test("the shift lifecycle fixes creation state and scopes every edit to its dancer", () => {
  const createWriter = shiftLifecycle.match(/export async function createScheduledDancerShift[\s\S]*?\n}/)?.[0] || "";
  const updateWriter = shiftLifecycle.match(/export async function updateOwnedDancerShift[\s\S]*?\n}/)?.[0] || "";

  assert.match(createWriter, /shift_source: "scheduled"/);
  assert.match(createWriter, /status: "posted"/);
  assert.match(updateWriter, /DANCER_SHIFT_UPDATE_FIELDS/);
  assert.match(updateWriter, /\.eq\("id", shiftId\)[\s\S]*?\.eq\("dancer_id", dancerId\)/);
  assert.match(updateWriter, /\.neq\("shift_source", "demo_locked"\)/);
  assert.match(updateWriter, /Dancer shift update was not applied/);
});

test("unsafe legacy shift writers are removed from the general dancer service", () => {
  assert.doesNotMatch(dancerService, /export type ShiftInput/);
  assert.doesNotMatch(dancerService, /export async function postShift/);
  assert.doesNotMatch(dancerService, /export async function updateShift/);
  assert.doesNotMatch(dancerService, /export async function cancelShift/);
  assert.doesNotMatch(dancerService, /\.from\("shifts"\)[\s\S]*?\.(insert|update|delete|upsert)\(/);
});
