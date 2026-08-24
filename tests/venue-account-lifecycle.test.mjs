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

test("venue owner account changes pause and restore the exact prior venue publication state", () => {
  assert.match(accountAuth, /\.select\("id, is_active"\)[\s\S]*?\.eq\("owner_user_id", userId\)/);
  assert.match(accountAuth, /mydancr_venue_was_active: priorVenueActive/);
  assert.match(accountAuth, /accountState !== "active"[\s\S]*?\.update\(\{ is_active: false \}\)/);
  assert.match(accountAuth, /accountState === "active"[\s\S]*?\.update\(\{ is_active: priorVenueActive \}\)/);
  assert.match(accountAuth, /if \(venueError \|\| metadataError\)[\s\S]*?account_state: "disabled"/);
  assert.match(accountRoute, /event: accountState === "disabled" \? "account\.self_disabled" : "account\.self_reactivated"/);
});

test("administrative suspensions cannot be undone through self-service reactivation", () => {
  assert.match(accountAuth, /auth\.admin\.getUserById\(userId\)/);
  assert.match(accountAuth, /app_metadata[\s\S]*?mydancr_self_disabled_at/);
  assert.match(accountAuth, /current\.account_state === "disabled" && !selfDisabledAt[\s\S]*?disabled by MyDancr/);
  assert.match(accountAuth, /auth\.admin\.updateUserById\(userId, \{[\s\S]*?app_metadata/);
  assert.match(accountAuth, /delete restoredMetadata\.mydancr_self_disabled_at/);
  assert.match(authRoute, /account\.role === "venue" && account\.accountState === "active"/);
  assert.match(authRoute, /account\.accountState === "deleted"[\s\S]*?account has been deleted/);
});

test("owner pauses block every venue team role while personal team-account deletion preserves the venue", () => {
  assert.match(venueAccess, /\.select\("account_state"\)[\s\S]*?\.eq\("id", venue\.owner_user_id\)/);
  assert.match(venueAccess, /owner\?\.account_state !== "active"/);
  assert.match(accountAuth, /\.eq\("owner_user_id", userId\)/);
  assert.doesNotMatch(accountAuth, /\.from\("venues"\)[\s\S]*?\.delete\(/);
  assert.doesNotMatch(accountAuth, /\.from\("venue_team_members"\)/);
});

test("venue dashboard exposes clear reversible and permanent account controls", () => {
  const controls = dashboard.match(/function AccountControlsPanel[\s\S]*?function CustomerPanel/)?.[0] || "";
  const venueAccount = dashboard.match(/id="venue-account"[\s\S]*?\{isVenueCardPreviewOpen/)?.[0] || "";
  assert.match(venueAccount, /accountRole="venue"/);
  assert.match(venueAccount, /venueAccessRole=\{venueRole\}/);
  assert.match(controls, /Disable venue account/);
  assert.match(controls, /make the venue private and pause access for the entire venue team/);
  assert.match(controls, /Reactivate venue account/);
  assert.match(controls, /Delete venue account/);
  assert.match(controls, /deleteConfirmation !== "DELETE"/);
  assert.match(controls, /you will be signed out immediately/);
  assert.match(controls, /window\.location\.replace\(nextState === "disabled" \? "\/dashboard\/venue#venue-account" : "\/dashboard\/venue"\)/);
  assert.match(controls, /requestAccountJson\(\{[\s\S]*?method: "DELETE"[\s\S]*?clearDashboardSession\(\)[\s\S]*?window\.location\.replace\("\/"\)/);
});
