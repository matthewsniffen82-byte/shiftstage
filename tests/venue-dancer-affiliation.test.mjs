import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  baseMigration,
  approvalMigration,
  restoreMigration,
  service,
  dancerRoute,
  venueRoute,
  checkInRoute,
  deals,
  dashboard,
  dancerNfcPanel,
  liveApp,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608050001_dancer_venue_affiliations.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608080002_venue_gated_dancer_profiles.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090001_restore_public_dancer_media.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-affiliations.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/venue-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dancer-verifications/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/shifts/check-in/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);
const migration = `${baseMigration}\n${approvalMigration}`;
const [nfcMigration, profileAuthorizationMigration, restoredFirstTapMigration, nfcTapRoute, venueNfcPanel] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090004_nfc_profile_authorization.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110001_restore_first_tap_nfc_affiliation.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
]);

test("legacy venue verification tokens remain private while their write APIs are retired", () => {
  assert.match(migration, /create table if not exists public\.venue_dancer_verification_tokens/);
  assert.match(migration, /token_digest text not null unique/);
  assert.doesNotMatch(migration, /raw_token|verification_token text/);
  assert.match(migration, /p_expires_at < v_now \+ interval '5 minutes'/);
  assert.match(migration, /p_expires_at > v_now \+ interval '15 minutes'/);
  assert.match(migration, /venue_id = p_venue_id/);
  assert.match(migration, /used_at is null/);
  assert.match(migration, /used_at = v_now/);
  assert.match(migration, /count\(\*\)[\s\S]*created_at >= v_now - interval '1 hour'/);
  assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(service, /createHmac\("sha256", secret\)\.update\(token\)\.digest\("hex"\)/);
  assert.match(dancerRoute, /Dancer QR approval has been retired/);
  assert.match(dancerRoute, /}, 410\)/);
  assert.doesNotMatch(dancerRoute, /QRCode\.toDataURL/);
  assert.match(dancerRoute, /cache-control": "private, no-store/);
});

test("a dressing-room tap creates the venue affiliation and approves an eligible profile", () => {
  assert.match(nfcMigration, /create table if not exists public\.dancer_nfc_enrollments/);
  assert.match(nfcMigration, /v_now \+ interval '7 days'/);
  assert.match(nfcMigration, /register_dancer_nfc_enrollment/);
  assert.match(nfcMigration, /finalize_pending_dancer_nfc_enrollment/);
  assert.match(nfcMigration, /approve_dancer_venue_affiliation_from_nfc/);
  assert.match(nfcMigration, /'method', 'nfc'/);
  assert.match(nfcTapRoute, /registerDancerFromNfc/);
  assert.match(nfcTapRoute, /venue affiliation and profile are active/);
  assert.match(restoredFirstTapMigration, /drop function if exists public\.check_in_manager_approved_dancer_from_nfc/);
  assert.match(profileAuthorizationMigration, /authorize_dancer_profile_from_nfc/);
  assert.match(profileAuthorizationMigration, /venue_approved_at = coalesce\(dancer\.venue_approved_at, v_enrollment\.tapped_at\)/);
  assert.match(profileAuthorizationMigration, /insert into public\.venue_dancer_affiliations/);
  assert.match(profileAuthorizationMigration, /Public visibility remains governed by profile completeness and media moderation/);
});

test("the NFC tap owns activation while authorized venue staff can revoke roster access", () => {
  assert.match(migration, /p_actor_user_id is distinct from v_venue\.owner_user_id/);
  assert.match(venueRoute, /requireVenueAccount/);
  assert.match(venueRoute, /requireVenueAccess\(admin, user\.id, "manage_roster"\)/);
  assert.match(venueRoute, /Manager QR approval has been retired/);
  assert.match(venueRoute, /revokeDancerVenueAffiliation/);
  assert.match(nfcMigration, /join public\.app_users owner on owner\.id = venue\.owner_user_id/);
  assert.match(nfcMigration, /owner\.role = 'venue'/);
  assert.match(nfcMigration, /owner\.account_state = 'active'/);
});

test("successful NFC affiliation durably creates an in-app dancer notification", () => {
  assert.match(nfcMigration, /insert into public\.notifications/);
  assert.match(nfcMigration, /'venue_affiliation_status'/);
  assert.match(nfcMigration, /'Venue affiliation activated'/);
  assert.match(nfcMigration, /'method', 'nfc'/);
});

test("check-ins and dancer-attributed commission require an active venue affiliation", () => {
  assert.match(migration, /enforce_verified_venue_affiliation_for_checkin/);
  assert.match(migration, /old\.checked_in_at is null or old\.checked_out_at is not null/);
  assert.match(migration, /from public\.venue_dancer_affiliations/);
  assert.match(migration, /affiliation\.status = 'active'/);
  assert.match(migration, /Venue manager approval is required before this dancer can check in/);
  assert.match(checkInRoute, /assertDancerVenueAffiliationForShift/);
  assert.match(checkInRoute, /code: "venue_verification_required"/);
  assert.match(deals, /dancerHasActiveVenueAffiliation/);
  assert.match(migration, /commission_tracking_stopped_at = coalesce\(commission_tracking_stopped_at, v_now\)/);
  assert.match(migration, /ended_reason = 'venue_affiliation_revoked'/);
});

test("dancer and venue dashboards expose the official NFC affiliation workflow", () => {
  assert.match(dashboard, /DancerNfcPanel/);
  assert.match(dancerNfcPanel, /Tap to approve your profile/);
  assert.match(dashboard, /VenueNfcTagPanel/);
  assert.match(venueNfcPanel, /Dressing room/);
  assert.match(venueNfcPanel, /staff never create tags, scan dancers, or approve profiles/i);
  assert.match(venueNfcPanel, /NFC-authorized roster/);
  assert.match(venueNfcPanel, /Approved by NFC/);
  assert.match(venueNfcPanel, /MyDancr programs and supplies every sticker/);
  assert.doesNotMatch(venueNfcPanel, /Create programming URL/);
  assert.doesNotMatch(venueNfcPanel, />Rotate</);
  assert.doesNotMatch(venueNfcPanel, />Disable</);
  assert.match(dancerRoute, /cache-control": "private, no-store/);
  assert.match(venueRoute, /cache-control": "private, no-store/);
});

test("the physical venue sticker validates the active tag and venue before activation", () => {
  assert.match(nfcMigration, /where tag\.id = p_tag_id and tag\.status = 'active' and tag\.tag_type = 'dressing_room'/);
  assert.match(nfcMigration, /where venue\.id = v_tag\.venue_id and venue\.is_active = true/);
  assert.match(nfcTapRoute, /tag\.type === "dressing_room"/);
  assert.match(dashboard, /initialNfcState=\{nfc \|\| null\}/);
});

test("restored dancer dashboards load affiliations after approval state hydration", () => {
  const openDashboard = liveApp.match(/function openDancerDashboard\(\)[\s\S]*?function closeDancerDashboard/)?.[0] || "";
  const affiliationLoader = liveApp.match(/function loadDancerVenueVerification[\s\S]*?function stopDancerVenueVerificationLifecycle/)?.[0] || "";

  assert.match(openDashboard, /const dancerApprovalProgressRequest = hydrateDancerApprovalProgress\(\)/);
  assert.match(openDashboard, /dancerApprovalProgressRequest\.then\(\(\) => \{/);
  assert.match(openDashboard, /venueVerificationSection && !venueVerificationSection\.hidden/);
  assert.match(openDashboard, /return loadDancerVenueVerification\(\)/);
  assert.match(affiliationLoader, /Sign in to load venues/);
  assert.match(affiliationLoader, /Sign in to your dancer account to load venue affiliations\./);
});

test("revocation is audited and immediately ends matching live shifts", () => {
  assert.match(migration, /create table if not exists public\.venue_dancer_affiliation_events/);
  assert.match(migration, /event_type in \('token_issued', 'affiliation_approved', 'affiliation_revoked'\)/);
  assert.match(migration, /insert into public\.venue_dancer_affiliation_events/);
  assert.match(migration, /update public\.shifts/);
  assert.match(migration, /checked_out_at = v_now/);
  assert.match(service, /DANCER_VENUE_AFFILIATION_APPROVED/);
  assert.match(service, /DANCER_VENUE_AFFILIATION_REVOKED/);
  assert.match(service, /venue_affiliation_status/);
  assert.match(approvalMigration, /select \* into v_replacement[\s\S]*status = 'active'/);
  const restoredRevocation = restoreMigration.match(/create or replace function public\.revoke_dancer_venue_affiliation[\s\S]*?\n\$\$;/)?.[0] || "";
  assert.doesNotMatch(restoredRevocation, /is_public = false/);
  assert.match(restoredRevocation, /'profileDeactivated', false/);
  assert.match(service, /Your profile media remains available/i);
});
