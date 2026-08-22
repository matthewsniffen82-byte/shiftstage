import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const liveShell = fs.readFileSync("outputs/index.html", "utf8");
const accountRoute = fs.readFileSync("app/api/account/route.ts", "utf8");
const dashboardClient = fs.readFileSync("app/dashboard/DashboardClient.tsx", "utf8");
const deletionConstraints = fs.readFileSync("supabase/migrations/202608150002_allow_account_login_deletion.sql", "utf8");
const auditHistoryConstraints = fs.readFileSync("supabase/migrations/202608150003_preserve_deleted_account_audit_history.sql", "utf8");

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
    /async function deleteLiveAccount\(role, button\)[\s\S]*?const deletionSession = authSession[\s\S]*?logoutAccount\(\{ message: "Deleting account…" \}\)[\s\S]*?deleteAuthenticatedJson\("\/api\/account", deletionSession\)[\s\S]*?finalizeDeletedAccount\(role\)/,
  );
  assert.match(
    liveShell,
    /function finalizeDeletedAccount\(role\) \{\s*saveAuthSession\(null\);[\s\S]*?logoutAccount\(\{ message: `\$\{accountRoleLabel\(role\)\} deleted` \}\);[\s\S]*?finally \{\s*window\.location\.replace\("\/"\);/,
  );
  assert.match(
    liveShell,
    /function logoutAccount\([^)]*\) \{\s*saveAuthSession\(null\)[\s\S]*?closeDashboard\(\)[\s\S]*?closeDancerDashboard\(\)[\s\S]*?closeVenueDashboard\(\)[\s\S]*?updateAccountHeader\(\)/,
  );
  assert.doesNotMatch(liveShell, /This demo will sign out of the account/);
});

test("the standalone dashboard clears the session and replaces browser history after deletion", () => {
  assert.match(
    dashboardClient,
    /async function deleteAccount\(\)[\s\S]*?clearDashboardSession\(\);[\s\S]*?method: "DELETE"[\s\S]*?finally \{\s*window\.location\.replace\("\/"\);/,
  );
  assert.match(
    dashboardClient,
    /event\.key === SESSION_KEY && !event\.newValue[\s\S]*?leaveDeletedSessionDashboard\(\);\s*window\.addEventListener\("pageshow", leaveDeletedSessionDashboard\)/,
  );
});

test("historical actor references cannot block permanent login deletion", () => {
  for (const column of [
    "venue_claim_codes_created_by_fkey",
    "venue_dancer_affiliations_approved_by_user_id_fkey",
    "venue_dancer_affiliation_events_actor_user_id_fkey",
    "nfc_tags_created_by_user_id_fkey",
    "venue_team_invitations_invited_by_user_id_fkey",
    "venue_nfc_support_requests_requested_by_user_id_fkey",
  ]) {
    assert.match(deletionConstraints, new RegExp(`drop constraint if exists ${column}`));
  }
  assert.equal((deletionConstraints.match(/on delete set null/g) || []).length, 6);
  assert.equal((deletionConstraints.match(/drop not null/g) || []).length, 6);
  for (const constraint of [
    "venue_claim_codes_used_pair_check",
    "venue_claim_codes_revoked_pair_check",
    "venue_dancer_affiliations_revoke_pair_check",
    "venue_dancer_verification_tokens_used_pair_check",
  ]) {
    assert.match(auditHistoryConstraints, new RegExp(`drop constraint if exists ${constraint}`));
  }
  assert.match(auditHistoryConstraints, /used_at is not null or used_by is null/);
  assert.match(auditHistoryConstraints, /revoked_at is not null or revoked_by is null/);
  assert.match(auditHistoryConstraints, /status = 'revoked' and revoked_at is not null/);
  assert.match(auditHistoryConstraints, /used_at is not null or used_by_user_id is null/);
});

test("the account endpoint permanently removes the authenticated login", () => {
  assert.match(accountRoute, /export async function DELETE\(request: Request\)/);
  assert.match(accountRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(accountRoute, /setAccountState\(client, user\.id, "deleted", admin\)/);
  assert.match(accountRoute, /admin\.auth\.admin\.deleteUser\(user\.id\)/);
  assert.match(accountRoute, /return NextResponse\.json\(\{ ok: true, account \}\);/);
  assert.doesNotMatch(
    accountRoute,
    /export async function DELETE[\s\S]*?return NextResponse\.json\(\{ ok: true, account, session \}\);/,
  );
});
