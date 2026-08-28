import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminDashboard, venuesRoute, venueMediaRoute, venueClaimCodesRoute] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/media/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venue-claim-codes/route.ts", import.meta.url), "utf8"),
]);

const venueManager = adminDashboard.match(/function VenueManager\([\s\S]*?function ApprovalQueue/)?.[0] || "";

test("admin venue management uses the refresh-aware role-isolated session boundary", () => {
  assert.equal((venueManager.match(/requestAdminJson\("\/api\/admin\/venues"/g) || []).length, 3);
  assert.equal((venueManager.match(/requestAdminJson\("\/api\/admin\/venues\/media"/g) || []).length, 2);
  assert.equal((venueManager.match(/requestAdminJson\("\/api\/admin\/venue-claim-codes"/g) || []).length, 1);
  assert.doesNotMatch(venueManager, /readToken\(\)|fetch\([\s\S]*?\/api\/admin\/(?:venues|venue-claim-codes)/);

  assert.equal(
    (venuesRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length,
    2,
  );
  assert.equal((venuesRoute.match(/session: session \|\| null/g) || []).length, 3);
  assert.equal(
    (venueMediaRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length,
    2,
  );
  assert.equal((venueMediaRoute.match(/session: session \|\| null/g) || []).length, 2);
  assert.equal(
    (venueClaimCodesRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length,
    2,
  );
  assert.equal((venueClaimCodesRoute.match(/session: session \|\| null/g) || []).length, 2);
});

test("admin venue management serializes actions and rejects stale responses", () => {
  assert.match(venueManager, /function beginVenueAction\(\)/);
  assert.match(venueManager, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(venueManager, /function isCurrentVenueAction/);
  assert.match(venueManager, /function finishVenueAction/);
  assert.equal((venueManager.match(/const action = beginVenueAction\(\)/g) || []).length, 6);
  assert.equal((venueManager.match(/signal: action\.controller\.signal/g) || []).length, 6);
  assert.equal((venueManager.match(/if \(!data\.venue\) throw new Error/g) || []).length, 5);
  assert.match(venueManager, /if \(!data\.claimCode\) throw new Error\("Unable to revoke venue access code\."\)/);
  assert.equal((venueManager.match(/finally \{[\s\S]*?finishVenueAction\(action\)/g) || []).length, 6);
  assert.match(venueManager, /fallbackMessage: "Unable to save venue page\."/);
  assert.match(venueManager, /fallbackMessage: "Unable to revoke venue access code\."/);
});
