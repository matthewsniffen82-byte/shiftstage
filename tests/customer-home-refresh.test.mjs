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
  assert.match(savedLoader, /if \(isCustomerSession\(\)\) showToast/);
  assert.match(homeSource, /if \(isCustomerSession\(\)\) await loadLiveCustomerSaved\(\)/);
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
  assert.match(profileRouteSource, /NextResponse\.json\(\{ ok: true, profile, session \}\)/);
});

test("saved customer queries support the deployed schema until is_public migration is applied", () => {
  assert.match(customerServiceSource, /function isMissingIsPublicColumnError/);
  assert.match(customerServiceSource, /code === "42703" \|\| code === "PGRST204"/);
  assert.match(customerServiceSource, /relation: "follows"/);
  assert.match(customerServiceSource, /relation: "favorites"/);
  assert.match(customerServiceSource, /relation: "going_signals"/);
  assert.match(
    customerServiceSource,
    /dancer_profiles\(id, slug, stage_name, city, status, dancer_photos\(storage_path, is_primary, review_status, sort_order\)\)/,
  );
});
