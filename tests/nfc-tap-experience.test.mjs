import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, restoredFirstTapMigration, profileAuthorizationMigration, adminProvisioningMigration, nfcService, tapRoute, tagRoute, adminTagRoute, tapClient, accountClient, dashboardRoute, dealCard, retiredDancerQr, legacyDealQr] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110001_restore_first_tap_nfc_affiliation.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090004_nfc_profile_authorization.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090005_admin_nfc_provisioning.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/venue-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/route.ts", import.meta.url), "utf8"),
]);

test("NFC stickers store only high-entropy token digests and are provisioned by MyDancr admins", () => {
  assert.match(migration, /create table if not exists public\.nfc_tags/);
  assert.match(migration, /token_digest text not null unique/);
  assert.doesNotMatch(migration, /raw_token|token_plaintext/);
  assert.match(nfcService, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(nfcService, /createHash\("sha256"\)/);
  assert.match(nfcService, /requireVenueAccess\(client, ownerUserId, "view_nfc"\)/);
  assert.match(adminProvisioningMigration, /create or replace function public\.rotate_admin_venue_nfc_tag/);
  assert.match(adminTagRoute, /setAdminVenueNfcTagStatus/);
  assert.match(adminTagRoute, /requireAdmin/);
  assert.match(tagRoute, /MyDancr supplies and programs venue NFC stickers/);
  assert.doesNotMatch(tagRoute, /setVenueNfcTagStatus/);
  assert.match(tagRoute, /cache-control.*private, no-store/s);
});

test("one dressing-room tag records, approves, affiliates, and checks in a dancer", () => {
  assert.match(migration, /register_dancer_nfc_enrollment/);
  assert.match(migration, /finalize_pending_dancer_nfc_enrollment/);
  assert.match(migration, /approve_dancer_venue_affiliation_from_nfc/);
  assert.match(profileAuthorizationMigration, /authorize_dancer_profile_from_nfc/);
  assert.match(profileAuthorizationMigration, /insert into public\.venue_dancer_affiliations/);
  assert.match(tapRoute, /account\?\.role !== "dancer"/);
  assert.match(tapRoute, /registerDancerFromNfc/);
  assert.match(nfcService, /register_dancer_nfc_enrollment/);
  assert.match(nfcService, /authorize_dancer_profile_from_nfc/);
  assert.match(accountClient, /dressing-room NFC sticker to approve your profile and add that club/);
  assert.match(dashboardRoute, /finalizePendingDancerNfcEnrollment/);
  assert.match(retiredDancerQr, /Dancer QR approval has been retired/);
});

test("repeat dressing-room taps are idempotent while pending taps finish automatically", () => {
  assert.match(migration, /on conflict \(dancer_user_id, venue_id\) do update/);
  assert.match(migration, /status = case when public\.dancer_nfc_enrollments\.status = 'completed' then 'completed' else 'pending' end/);
  assert.match(migration, /'affiliationActivated', v_affiliation_activated/);
  assert.match(migration, /'profileActivated', v_profile_activated/);
  assert.match(restoredFirstTapMigration, /drop function if exists public\.check_in_manager_approved_dancer_from_nfc/);
  assert.match(restoredFirstTapMigration, /grant execute on function public\.register_dancer_nfc_enrollment[\s\S]*service_role/);
  assert.match(restoredFirstTapMigration, /grant execute on function public\.finalize_pending_dancer_nfc_enrollment[\s\S]*service_role/);
});

test("cashier NFC redemption preserves deal and current-shift attribution and prevents replay", () => {
  assert.match(migration, /confirm_deal_redemption_from_nfc/);
  assert.match(migration, /v_redemption\.venue_id <> v_tag\.venue_id/);
  assert.match(migration, /v_redemption\.dancer_id is null or v_redemption\.shift_id is null/);
  assert.match(migration, /previous\.redeemed_at >= v_now - interval '24 hours'/);
  assert.match(migration, /previous\.customer_id = v_redemption\.customer_id/);
  assert.match(migration, /previous\.session_id = v_redemption\.session_id/);
  assert.match(migration, /'source', 'cashier_nfc_tap'/);
  assert.match(tapRoute, /verifyDancerDealAttributionToken/);
  assert.match(tapRoute, /getVerifiedActiveCheckInAtVenue/);
  assert.match(tapRoute, /campaignSource: "venue_nfc"/);
  assert.match(tapRoute, /confirmRedemptionFromNfc/);
});

test("customers select a live offer in MyDancr and complete it only by tapping the venue cashier sticker", () => {
  assert.match(dealCard, /mydancrPendingNfcDealV1/);
  assert.match(dealCard, /Tap the MyDancr NFC sticker at the cashier/);
  assert.match(tapClient, /readPendingDealIntent/);
  assert.match(tapClient, /Redeem this Club Deal/);
  assert.match(tapClient, /crypto\.randomUUID\(\)/);
  assert.match(legacyDealQr, /status: 410/);
  assert.match(legacyDealQr, /cashier NFC sticker/);
});

test("NFC tap activity is auditable without exposing the reusable tag token", () => {
  assert.match(migration, /create table if not exists public\.nfc_tap_events/);
  assert.match(migration, /ip_address text/);
  assert.match(migration, /user_agent text/);
  assert.match(migration, /device_fingerprint text/);
  assert.match(migration, /tap_count = tap_count \+ 1/);
  const eventTable = migration.match(/create table if not exists public\.nfc_tap_events \([\s\S]*?\n\);/)?.[0] || "";
  assert.doesNotMatch(eventTable, /token_digest|raw_token|token_plaintext/);
});
