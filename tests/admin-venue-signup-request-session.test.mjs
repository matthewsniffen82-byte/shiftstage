import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, venueSignupRequestRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-signup-requests/route.ts", import.meta.url), "utf8"),
]);

const venueSignupRequestQueue = adminDashboard.match(
  /function VenueSignupRequestQueue\([\s\S]*?function VenueManager/,
)?.[0] || "";

test("admin venue signup reviews use the refresh-aware role-isolated session boundary", () => {
  assert.equal(
    (venueSignupRequestRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length,
    2,
  );
  assert.equal((venueSignupRequestRoute.match(/session: session \|\| null/g) || []).length, 2);
  assert.equal(
    (venueSignupRequestQueue.match(/requestAdminJson\("\/api\/admin\/venue-signup-requests"/g) || []).length,
    1,
  );
  assert.doesNotMatch(venueSignupRequestQueue, /readToken\(\)|fetch\([\s\S]*?\/api\/admin\/venue-signup-requests/);
});

test("admin venue signup reviews retain validation, recovery, and duplicate-submit protection", () => {
  assert.match(venueSignupRequestQueue, /function beginVenueSignupReview\(\)/);
  assert.match(venueSignupRequestQueue, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(venueSignupRequestQueue, /signal: review\.controller\.signal/);
  assert.match(venueSignupRequestQueue, /function isCurrentVenueSignupReview/);
  assert.match(venueSignupRequestQueue, /function finishVenueSignupReview/);
  assert.match(venueSignupRequestQueue, /fallbackMessage: "Unable to review the venue request\."/);
  assert.match(venueSignupRequestQueue, /decision === "rejected" && !notes/);
  assert.match(venueSignupRequestQueue, /catch \(error\)[\s\S]*?error instanceof Error \? error\.message/);
  assert.match(venueSignupRequestQueue, /finally \{[\s\S]*?finishVenueSignupReview\(review\)/);
  assert.equal((venueSignupRequestQueue.match(/disabled=\{Boolean\(busyRequestId\)\}/g) || []).length, 3);
});
