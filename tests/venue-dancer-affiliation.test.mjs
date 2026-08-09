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

test("venue affiliation tokens are private, short-lived, venue-bound, and single-use", () => {
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
  assert.match(dancerRoute, /QRCode\.toDataURL/);
  assert.match(dancerRoute, /errorCorrectionLevel: "H"/);
});

test("only the exact verified venue owner can approve or revoke an affiliation", () => {
  assert.match(migration, /v_venue\.owner_user_id is distinct from p_manager_user_id/);
  assert.match(migration, /Only this venue''s verified manager can approve the dancer/);
  assert.match(migration, /p_actor_user_id is distinct from v_venue\.owner_user_id/);
  assert.match(venueRoute, /account\.role !== "venue"/);
  assert.match(venueRoute, /approveDancerVenueVerification/);
  assert.match(venueRoute, /revokeDancerVenueAffiliation/);
  assert.match(service, /\.eq\("owner_user_id", managerUserId\)/);
  assert.match(service, /requireVenueApprovalCandidate/);
  assert.match(service, /avatar must pass automated moderation/i);
  assert.doesNotMatch(service, /requireApprovedDancer/);
  assert.match(approvalMigration, /status = 'approved'/);
  assert.match(approvalMigration, /venue_approved_at = coalesce/);
  assert.match(approvalMigration, /'profileActivated', v_profile_activated/);
  assert.match(approvalMigration, /where affiliation\.status = 'active'[\s\S]*affiliation\.revoked_at is null/);
  assert.match(approvalMigration, /not exists \(\s*select 1 from public\.dancer_photos/);
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

test("dancer and venue dashboards expose the complete one-tap verification flow", () => {
  assert.match(dashboard, /Show my verification QR/);
  assert.match(dashboard, /Confirm she works here/);
  assert.match(liveApp, /Confirm where you work/);
  assert.match(liveApp, /Show my verification QR/);
  assert.match(liveApp, /Confirm she works here/);
  assert.match(liveApp, /Approved roster/);
  assert.match(liveApp, /confirms only that you are affiliated/i);
  assert.match(liveApp, /dancrPendingVenueDancerVerificationV1/);
  assert.match(liveApp, /handleVenueDancerVerificationDeepLink/);
  assert.match(liveApp, /processPendingVenueDancerVerification/);
  assert.match(liveApp, /sessionStorage\.setItem\(PENDING_VENUE_DANCER_VERIFICATION_KEY/);
  assert.match(liveApp, /savePendingVenueDancerVerificationToken\(""\)/);
  assert.match(liveApp, /navigator\.share/);
  assert.match(liveApp, /navigator\.clipboard\.writeText/);
  assert.match(dancerRoute, /cache-control": "private, no-store/);
  assert.match(venueRoute, /cache-control": "private, no-store/);
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
