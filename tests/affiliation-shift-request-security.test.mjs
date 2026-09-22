import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dancerAffiliation, venueAffiliation, shifts, shiftActions] = await Promise.all([
  readFile(new URL("../app/api/dancer/venue-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dancer-verifications/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
]);

test("both sides of venue affiliation use bounded authenticated request bodies", () => {
  for (const route of [dancerAffiliation, venueAffiliation]) {
    assert.match(route, /const MAX_AFFILIATION_BODY_BYTES = 2_048/);
    assert.match(route, /readBoundedJsonObject\(request, \{/);
    assert.match(route, /maxBytes: MAX_AFFILIATION_BODY_BYTES/);
    assert.doesNotMatch(route, /request\.json\(/);
  }
  assert.match(dancerAffiliation, /createRequestSupabaseContext\(request\)[\s\S]*?readBoundedJsonObject/);
  assert.match(venueAffiliation, /requireVenueAccess\(admin, user\.id, "manage_roster"\)[\s\S]*?readBoundedJsonObject/);
});

test("dancer shift creation, editing, and ending use bounded authenticated bodies", () => {
  assert.match(shifts, /createRequestSupabaseContext\(request, \{ role: "dancer" \}\)/);
  assert.match(shifts, /code: "upcoming_shifts_retired"/);
  assert.match(shifts, /status: 410/);
  assert.match(shifts, /export const POST = retiredSchedule/);
  assert.match(shifts, /export const PATCH = retiredSchedule/);
  assert.doesNotMatch(shifts, /request\.json\(|createScheduledDancerShift|broadcastFollowedDancerUpcomingShift/);

  assert.match(shiftActions, /const MAX_SHIFT_ACTION_BODY_BYTES = 2_048/);
  assert.match(shiftActions, /readShiftActionBody\(request\)/);
  assert.match(shiftActions, /maxBytes: MAX_SHIFT_ACTION_BODY_BYTES/);
  assert.match(shiftActions, /UUID_PATTERN\.test\(shiftId\)/);
  assert.doesNotMatch(shiftActions, /request\.json\(/);
});
