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
  assert.match(shifts, /const MAX_SHIFT_BODY_BYTES = 4_096/);
  assert.match(shifts, /readShiftBody\(request\)/);
  assert.match(shifts, /maxBytes: MAX_SHIFT_BODY_BYTES/);
  assert.match(shifts, /UUID_PATTERN\.test\(candidate\)/);
  assert.match(shifts, /const timezone = venue\.timezone/);
  assert.doesNotMatch(shifts, /body\.timezone/);
  assert.doesNotMatch(shifts, /request\.json\(/);

  assert.match(shiftActions, /const MAX_SHIFT_ACTION_BODY_BYTES = 2_048/);
  assert.match(shiftActions, /readShiftActionBody\(request\)/);
  assert.match(shiftActions, /maxBytes: MAX_SHIFT_ACTION_BODY_BYTES/);
  assert.match(shiftActions, /UUID_PATTERN\.test\(shiftId\)/);
  assert.doesNotMatch(shiftActions, /request\.json\(/);
});
