import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, savedRouteSource, profileRouteSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/saved/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/profile/route.ts", import.meta.url), "utf8"),
]);

test("home refresh only requests saved customer data for a customer session", () => {
  const savedLoader =
    homeSource.match(/async function loadLiveCustomerSaved[\s\S]*?\r?\n    }\r?\n\r?\n    async function loadLiveCustomerDashboardData/)?.[0] || "";

  assert.match(savedLoader, /if \(!isCustomerSession\(\)\) return/);
  assert.match(savedLoader, /if \(isCustomerSession\(\)\) showToast/);
  assert.match(homeSource, /if \(isCustomerSession\(\)\) await loadLiveCustomerSaved\(\)/);
  assert.doesNotMatch(homeSource, /if \(authSession\?\.accessToken\) await loadLiveCustomerSaved\(\)/);
});

test("customer refresh responses persist any rotated authentication session", () => {
  assert.match(savedRouteSource, /const \{ client, user, session \} = await createRequestSupabaseContext\(request\)/);
  assert.match(savedRouteSource, /NextResponse\.json\(\{ ok: true, saved, session \}\)/);
  assert.match(profileRouteSource, /const \{ client, user, session \} = await createRequestSupabaseContext\(request\)/);
  assert.match(profileRouteSource, /NextResponse\.json\(\{ ok: true, profile, session \}\)/);
});
