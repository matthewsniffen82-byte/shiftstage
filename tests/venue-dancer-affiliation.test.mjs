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
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);
const migration = `${baseMigration}\n${approvalMigration}`;
const [nfcMigration, profileAuthorizationMigration, nfcTapRoute, venueNfcPanel, dancerNfcPanel] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090004_nfc_profile_authorization.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
]);

test("retired venue verification tokens remain private while issuance is permanently disabled", () => {
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
  assert.match(dancerRoute, /}, 410\);/);
  assert.match(dancerRoute, /replacement: "dressing_room_nfc"/);
  assert.doesNotMatch(dancerRoute, /QRCode\.toDataURL/);
});

test("a dressing-room tap persists pending onboarding and activates without manager approval", () => {
  assert.match(nfcMigration, /create table if not exists public\.dancer_nfc_enrollments/);
  assert.match(nfcMigration, /v_now \+ interval '7 days'/);
  assert.match(nfcMigration, /register_dancer_nfc_enrollment/);
  assert.match(nfcMigration, /finalize_pending_dancer_nfc_enrollment/);
  assert.match(nfcMigration, /approve_dancer_venue_affiliation_from_nfc/);
  assert.match(nfcMigration, /'method', 'nfc'/);
  assert.match(nfcTapRoute, /registerDancerFromNfc/);
  assert.doesNotMatch(nfcTapRoute, /manager.*approve/i);
  assert.match(profileAuthorizationMigration, /authorize_dancer_profile_from_nfc/);
  assert.match(profileAuthorizationMigration, /venue_approved_at = coalesce\(dancer\.venue_approved_at, v_enrollment\.tapped_at\)/);
  assert.match(profileAuthorizationMigration, /insert into public\.venue_dancer_affiliations/);
  assert.match(profileAuthorizationMigration, /Public visibility remains governed by profile completeness and media moderation/);
});

test("manager approval is retired while the exact venue owner can still revoke an affiliation", () => {
  assert.match(migration, /v_venue\.owner_user_id is distinct from p_manager_user_id/);
  assert.match(migration, /Only this venue''s verified manager can approve the dancer/);
  assert.match(migration, /p_actor_user_id is distinct from v_venue\.owner_user_id/);
  assert.match(venueRoute, /requireVenueAccount/);
  assert.match(venueRoute, /}, 410\);/);
  assert.match(venueRoute, /replacement: "dressing_room_nfc"/);
  assert.doesNotMatch(venueRoute, /approveDancerVenueVerification/);
  assert.match(venueRoute, /revokeDancerVenueAffiliation/);
  assert.match(nfcMigration, /join public\.app_users owner on owner\.id = venue\.owner_user_id/);
  assert.match(nfcMigration, /owner\.role = 'venue'/);
  assert.match(nfcMigration, /owner\.account_state = 'active'/);
});

test("successful venue approval durably creates one dancer in-app affiliation notification", () => {
  const approvalService = service.match(
    /export async function approveDancerVenueVerification[\s\S]*?export async function revokeDancerVenueAffiliation/,
  )?.[0] || "";
  assert.match(approvalService, /persistVenueAffiliationApprovalNotification\(client, notification\)/);
  assert.match(approvalService, /\.from\("notifications"\)[\s\S]*?\.upsert\(notification, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
  assert.match(approvalService, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
  assert.match(approvalService, /venueAffiliationApprovalNotificationId\(String\(data\.id\), String\(data\.approvedAt\)\)/);
  assert.match(approvalService, /notification_type: "venue_affiliation_status"/);
  assert.match(approvalService, /channel: "in_app"/);
  assert.match(service, /title: "Venue affiliation approved"/);
  assert.match(service, /approved your venue affiliation/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.match(service, /mydancr:venue-affiliation-approved:\$\{affiliationId\}:\$\{approvedAt\}/);
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

test("dancer and venue dashboards expose the complete dressing-room NFC flow", () => {
  assert.match(dashboard, /DancerNfcPanel/);
  assert.match(dashboard, /VenueNfcTagPanel/);
  assert.match(dancerNfcPanel, /tap its official MyDancr sticker in the dressing room/);
  assert.match(dancerNfcPanel, /No manager scan or separate approval is waiting/);
  assert.match(dancerNfcPanel, /Media safety moderation remains separate/);
  assert.match(venueNfcPanel, /Dressing room/);
  assert.match(venueNfcPanel, /staff never create tags, scan dancers, or approve profiles/i);
  assert.match(venueNfcPanel, /NFC-authorized roster/);
  assert.match(venueNfcPanel, /MyDancr programs and supplies every sticker/);
  assert.doesNotMatch(venueNfcPanel, /Create programming URL/);
  assert.doesNotMatch(venueNfcPanel, />Rotate</);
  assert.doesNotMatch(venueNfcPanel, />Disable</);
  assert.match(dancerRoute, /cache-control": "private, no-store/);
  assert.match(venueRoute, /cache-control": "private, no-store/);
});

test("the physical venue sticker determines affiliation without a dancer venue dropdown", () => {
  assert.match(nfcMigration, /where tag\.id = p_tag_id and tag\.status = 'active' and tag\.tag_type = 'dressing_room'/);
  assert.match(nfcMigration, /where venue\.id = v_tag\.venue_id and venue\.is_active = true/);
  assert.match(profileAuthorizationMigration, /insert into public\.venue_dancer_affiliations/);
  assert.match(profileAuthorizationMigration, /on conflict \(venue_id, dancer_id\) do update/);
  assert.doesNotMatch(dancerNfcPanel, /<select|venue dropdown/i);
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
