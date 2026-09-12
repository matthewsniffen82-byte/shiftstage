import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [accountAuth, accountRoute, authRoute, venueAccess, dashboard] = await Promise.all([
  readFile(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-access.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("venue owner account changes use one server transaction with an exact account result", () => {
  assert.match(accountAuth, /rpc\("transition_own_account_safely"/);
  assert.match(accountAuth, /p_user_id: userId, p_account_state: accountState/);
  assert.match(accountAuth, /data\.id !== userId \|\| data\.account_state !== accountState/);
  assert.match(accountRoute, /event: accountState === "disabled" \? "account\.self_disabled" : "account\.self_reactivated"/);
});
test("self-service restoration requires private database ownership, with no Auth compensation", () => {
  const writer = accountAuth.slice(accountAuth.indexOf("export async function setAccountState"), accountAuth.indexOf("export async function getCustomerProfile"));
  assert.doesNotMatch(writer, /auth\.admin|mydancr_self_disabled_at|\.from\(/);
  assert.match(writer, /result\.error\.code === "42501"/);
  assert.match(authRoute, /account\.role === "venue" && account\.accountState === "active"/);
  assert.match(authRoute, /account\.accountState === "deleted"[\s\S]*?account has been deleted/);
});
test("owner pauses block venue team access while account operations keep the authenticated target", () => {
  assert.match(venueAccess, /\.select\("account_state"\)[\s\S]*?\.eq\("id", venue\.owner_user_id\)/);
  assert.match(venueAccess, /owner\?\.account_state !== "active"/);
  assert.match(accountRoute, /setAccountState\(client, user\.id, accountState, createAdminSupabaseClient\(\)\)/);
});

test("venue dashboard exposes clear reversible and permanent account controls", () => {
  const controls = dashboard.match(/function AccountControlsPanel[\s\S]*?function CustomerPanel/)?.[0] || "";
  const venueAccount = dashboard.slice(dashboard.indexOf("function VenuePanel(")).match(/id="venue-account"[\s\S]*?accountRole="venue"[\s\S]*?\/>/)?.[0] || "";
  assert.match(venueAccount, /accountRole="venue"/);
  assert.match(venueAccount, /venueAccessRole=\{venueRole\}/);
  assert.match(controls, /Disable venue account/);
  assert.match(controls, /make the venue private and pause access for the entire venue team/);
  assert.match(controls, /Reactivate venue account/);
  assert.match(controls, /Delete venue account/);
  assert.match(controls, /deleteConfirmation !== "DELETE"/);
  assert.match(controls, /you will be signed out immediately/);
  assert.match(controls, /window\.history\.replaceState\(window.history.state, "", nextState === "disabled" \? "\/dashboard\/venue#venue-account" : "\/dashboard\/venue"\);\s*window\.location\.reload\(\)/);
  assert.match(controls, /requestAccountJson\(\{[\s\S]*?method: "DELETE"[\s\S]*?clearDashboardSession\(\)[\s\S]*?window\.location\.replace\("\/"\)/);
});
