import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const liveShell = fs.readFileSync("outputs/index.html", "utf8");
const accountRoute = fs.readFileSync("app/api/account/route.ts", "utf8");
const dashboardClient = fs.readFileSync("app/dashboard/DashboardClient.tsx", "utf8");

test("every supported signed-in role gets a persistent account-menu deletion control", () => {
  assert.match(
    liveShell,
    /id="sessionMenuEnd"[\s\S]*?id="logoutBtn"[\s\S]*?id="deleteAccountBtn"[^>]*>Delete account<\/button>/,
  );
  assert.match(
    liveShell,
    /function updateAccountHeader\(\)[\s\S]*?deleteAccountBtn\.hidden = !loggedIn \|\| !\["customer", "dancer", "venue"\]\.includes\(sessionRole\)[\s\S]*?deleteAccountBtn\.dataset\.accountRole = sessionRole \|\| ""/,
  );
});

test("the global deletion control requires confirmation and calls the authenticated production deletion flow", () => {
  assert.match(
    liveShell,
    /deleteAccountBtn\.addEventListener\("click", async \(\) => \{[\s\S]*?authSession\?\.accessToken[\s\S]*?window\.confirm\(`[\s\S]*?This cannot be undone\.`\)[\s\S]*?await deleteLiveAccount\(role, deleteAccountBtn\)/,
  );
  assert.match(
    liveShell,
    /async function deleteLiveAccount\(role, button\)[\s\S]*?deleteAuthenticatedJson\("\/api\/account"\)[\s\S]*?finalizeDeletedAccount\(role\)/,
  );
  assert.match(
    liveShell,
    /function finalizeDeletedAccount\(role\) \{\s*logoutAccount\(\{ message: `\$\{accountRoleLabel\(role\)\} deleted` \}\);\s*\}/,
  );
  assert.match(
    liveShell,
    /function logoutAccount\([\s\S]*?saveAuthSession\(null\)[\s\S]*?closeDashboard\(\)[\s\S]*?closeDancerDashboard\(\)[\s\S]*?closeVenueDashboard\(\)[\s\S]*?updateAccountHeader\(\)/,
  );
  assert.doesNotMatch(liveShell, /This demo will sign out of the account/);
});

test("the standalone dashboard clears the session and replaces browser history after deletion", () => {
  assert.match(
    dashboardClient,
    /async function deleteAccount\(\)[\s\S]*?method: "DELETE"[\s\S]*?window\.localStorage\.removeItem\(SESSION_KEY\);\s*window\.location\.replace\("\/"\);/,
  );
});

test("the account endpoint permanently removes the authenticated login", () => {
  assert.match(accountRoute, /export async function DELETE\(request: Request\)/);
  assert.match(accountRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(accountRoute, /setAccountState\(client, user\.id, "deleted"\)/);
  assert.match(accountRoute, /admin\.auth\.admin\.deleteUser\(user\.id\)/);
});
