import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  access,
  team,
  teamRoute,
  inviteRoute,
  authRoute,
  dashboard,
  dashboardRoute,
  nfcService,
  nfcRoute,
  nfcPanel,
  supportRoute,
  apiHelpers,
  apiPolicy,
  migration,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/venue-access.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-team.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/team/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/team/invitations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/nfc-support/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api-error-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608100001_venue_team_operations.sql", import.meta.url), "utf8"),
]);

test("venue team roles are least-privilege and private workspace access remains venue-scoped", () => {
  assert.match(access, /export type VenueTeamRole = "owner" \| "manager" \| "staff"/);
  const managerPermissions = access.match(/manager: \[([\s\S]*?)\],/)?.[1] || "";
  assert.match(managerPermissions, /"manage_profile"/);
  assert.match(managerPermissions, /"manage_roster"/);
  assert.doesNotMatch(managerPermissions, /"manage_deals"/);
  const staffPermissions = access.match(/staff: \[([\s\S]*?)\],/)?.[1] || "";
  assert.match(staffPermissions, /"view_dashboard"/);
  assert.match(staffPermissions, /"view_nfc"/);
  assert.doesNotMatch(staffPermissions, /manage_/);
  assert.match(access, /\.eq\("status", "active"\)/);
  assert.doesNotMatch(access, /\.eq\("venues\.is_active", true\)/);
  assert.match(team, /account:app_users!venue_team_members_user_id_fkey/);
  assert.match(apiHelpers, /resolveApiError/);
  assert.match(apiPolicy, /Your venue team role does not allow this action[\s\S]*?status: 403/);
  assert.match(migration, /venue_team_members_active_user_idx[\s\S]*?where status = 'active'/);
  assert.match(migration, /This account already belongs to another venue team/);
});

test("venue invitations are expiring, hashed, email-bound, and service-role redeemed", () => {
  assert.match(team, /crypto\.randomBytes\(36\)\.toString\("base64url"\)/);
  assert.match(team, /createHash\("sha256"\)/);
  assert.match(team, /Math\.max\(1, Math\.min\(14/);
  assert.match(team, /resolveVenueTeamInvitation\(client, input\.token, input\.email\)/);
  assert.match(migration, /token_digest text not null unique/);
  assert.doesNotMatch(migration, /\btoken text\b/);
  assert.match(migration, /revoke all on function public\.redeem_venue_team_invitation[\s\S]*?grant execute[\s\S]*?service_role/);
  assert.match(inviteRoute, /requireActiveVenueAccount/);
  assert.match(authRoute, /venueInvitationToken/);
  assert.match(authRoute, /redeemVenueTeamInvitation/);
  assert.match(teamRoute, /sendTransactionalEmail/);
  assert.doesNotMatch(teamRoute, /headers\.get\("origin"\)/);
});

test("venue dashboard live operations refresh real data and expose honest working-now verification", () => {
  assert.match(dashboard, /window\.setInterval\(refreshWhenVisible, 45_000\)/);
  assert.match(dashboard, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(dashboard, /requestVenueDashboardJson\(analyticsPeriod/);
  assert.doesNotMatch(dashboard, /readOptionalJson\(`\/api\/venue\/dashboard/);
  assert.match(dashboard, /\["tonight", "7d", "30d"\]/);
  assert.match(dashboard, /isPublished \? "LIVE" : "PRIVATE DRAFT"/);
  assert.match(dashboard, /Check-in verified/);
  assert.match(dashboard, /Active until/);
  assert.doesNotMatch(dashboard, /Scheduled until/);
  assert.match(dashboard, /hours === 1 \? "hr" : "hrs"/);
  assert.match(dashboard, /VenueTeamPanel/);
  assert.match(dashboardRoute, /readVenueAnalyticsPeriod/);
  assert.match(dashboardRoute, /canVenue\(access, "view_finance"\)/);
  assert.match(dashboardRoute, /refreshedAt: new Date\(\)\.toISOString\(\)/);
});

test("physical NFC testing is separate from completed dancer and cashier actions", () => {
  assert.match(migration, /scan_count bigint not null default 0/);
  assert.match(migration, /record_nfc_tag_scan/);
  assert.match(migration, /revoke all on function public\.record_nfc_tag_scan[\s\S]*?service_role/);
  assert.match(nfcService, /recordNfcTagScan/);
  assert.match(nfcService, /lastScannedAt/);
  assert.match(nfcRoute, /await recordNfcTagScan\(admin, tag\.id\)/);
  assert.match(nfcPanel, /testBaselineRef\.current = tag\.scanCount/);
  assert.match(nfcPanel, /tested\.scanCount > testBaselineRef\.current/);
  assert.match(nfcPanel, /let checkInFlight = false;[\s\S]*?controller\.signal\.aborted \|\| document\.visibilityState !== "visible" \|\| checkInFlight/);
  assert.match(nfcPanel, /fallbackMessage: "Unable to check sticker activity\.",[\s\S]*?signal: controller\.signal/);
  assert.equal((nfcPanel.match(/if \(controller\.signal\.aborted\) return;/g) || []).length, 2);
  assert.match(nfcPanel, /controller\.abort\(\);[\s\S]*?document\.removeEventListener\("visibilitychange", checkTap\)/);
  assert.match(nfcPanel, /window\.setInterval\(checkTap, 3_000\)/);
  assert.match(nfcPanel, /document\.addEventListener\("visibilitychange", checkTap\)/);
  assert.match(nfcPanel, /document\.removeEventListener\("visibilitychange", checkTap\)/);
  assert.doesNotMatch(nfcPanel, /window\.setInterval\(\(\) => void checkTap\(\), 3_000\)/);
  assert.match(nfcPanel, /tag\.tapCount/);
});

test("NFC support and venue changes create durable operational records", () => {
  assert.match(supportRoute, /venue_nfc_support_requests/);
  assert.match(supportRoute, /createOwnSupportMessage/);
  assert.match(supportRoute, /\.eq\("venue_id", access\.venueId\)/);
  assert.match(supportRoute, /notes\.length > 1000/);
  assert.match(supportRoute, /recordVenueActivity/);
  assert.match(migration, /create table if not exists public\.venue_activity_log/);
  assert.match(migration, /create table if not exists public\.venue_nfc_support_requests/);
  assert.match(migration, /alter table public\.venue_activity_log enable row level security/);
  assert.match(migration, /Venue team reads own activity/);
});
