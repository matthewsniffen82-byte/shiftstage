import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, savedRouteSource, profileRouteSource, customerServiceSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/saved/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/customer.ts", import.meta.url), "utf8"),
]);

test("home refresh only requests saved customer data for a customer session", () => {
  const savedLoader =
    homeSource.match(/async function loadLiveCustomerSaved[\s\S]*?\r?\n    }\r?\n\r?\n    async function loadLiveCustomerDashboardData/)?.[0] || "";

  assert.match(savedLoader, /if \(!isCustomerSession\(\)\) return/);
  assert.match(savedLoader, /Customer saved state unavailable; keeping the current page state/);
  assert.doesNotMatch(savedLoader, /showToast/);
  assert.match(homeSource, /if \(isCustomerSession\(\) && !background\) void loadLiveCustomerSaved\(\)/);
  assert.doesNotMatch(homeSource, /if \(authSession\?\.accessToken\) await loadLiveCustomerSaved\(\)/);
  assert.match(
    homeSource,
    /async function loadLiveProfileActionState\(\) \{\s+if \(!isCustomerSession\(\)\) return/,
  );
  assert.doesNotMatch(
    homeSource,
    /else if \(authSession\?\.accessToken\) await loadLiveProfileActionState\(\)/,
  );
  assert.match(
    homeSource,
    /function isCustomerSession\(\) \{\s+return Boolean\(authSession\?\.accessToken && authSession\?\.account\?\.role === "customer"\)/,
  );
});

test("customer refresh responses persist any rotated authentication session", () => {
  assert.match(savedRouteSource, /const \{ client, user, session \} = await createRequestSupabaseContext\(request\)/);
  assert.match(savedRouteSource, /NextResponse\.json\(\{ ok: true, saved, session \}\)/);
  assert.match(profileRouteSource, /const \{ client, user, session \} = await createRequestSupabaseContext\(request\)/);
  assert.match(profileRouteSource, /NextResponse\.json\(\{ ok: true, profile: \{ \.\.\.profile, notificationDelivery: customerNotificationDelivery\(user.id, user.email\) \}, session \}\)/);
});

test("saved customer queries require the deployed visibility boundary", () => {
  assert.doesNotMatch(customerServiceSource, /isMissingIsPublicColumnError|CUSTOMER_SAVED_VISIBILITY_COLUMN_MISSING/);
  assert.match(customerServiceSource, /verification_status, venue_approved_at, disabled_at, is_public/);
  assert.match(customerServiceSource, /if \(!isShiftPubliclyVisible\(shift\)\) continue/);
});

test("missing private Club Deal storage cannot fail existing saved customer items", () => {
  assert.match(customerServiceSource, /function isMissingCustomerDealSavesTableError/);
  assert.match(customerServiceSource, /code === "42P01" \|\| code === "PGRST205"/);
  assert.match(customerServiceSource, /message\.includes\("customer_deal_saves"\)/);
  assert.match(customerServiceSource, /warnCustomerDealSavesUnavailable\("load", error\);\s+return \[\];/);
});
