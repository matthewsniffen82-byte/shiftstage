import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, managerApprovedNfcMigration, adminProvisioningMigration, nfcService, tapRoute, tagRoute, adminTagRoute, tapClient, accountClient, dashboardRoute, dealCard, legacyDancerQr, legacyDealQr] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608100003_require_manager_approval_for_nfc_checkin.sql", import.meta.url), "utf8"),
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

test("one dressing-room tag supports check-in only after venue manager affiliation approval", () => {
  assert.match(managerApprovedNfcMigration, /check_in_manager_approved_dancer_from_nfc/);
  assert.match(managerApprovedNfcMigration, /dancer\.status = 'approved'[\s\S]*dancer\.verification_status = 'approved'[\s\S]*dancer\.is_public = true/);
  assert.match(managerApprovedNfcMigration, /affiliation\.status = 'active'/);
  assert.doesNotMatch(managerApprovedNfcMigration, /insert into public\.venue_dancer_affiliations|update public\.dancer_profiles/);
  assert.match(tapRoute, /account\?\.role !== "dancer"/);
  assert.match(tapRoute, /venue_dancer_affiliations/);
  assert.match(tapRoute, /manager must scan your dancer approval QR/);
  assert.match(tapRoute, /checkInDancerFromNfc/);
  assert.match(nfcService, /check_in_manager_approved_dancer_from_nfc/);
  assert.doesNotMatch(nfcService, /register_dancer_nfc_enrollment|finalize_pending_dancer_nfc_enrollment|authorize_dancer_profile_from_nfc/);
  assert.match(accountClient, /verified venue manager approves only your venue affiliation/);
  assert.doesNotMatch(dashboardRoute, /finalizePendingDancerNfcEnrollment/);
  assert.match(legacyDancerQr, /issueDancerVenueVerification/);
  assert.match(legacyDancerQr, /QRCode\.toDataURL/);
});

test("repeat dressing-room taps preserve manager approval and record check-in activity only", () => {
  assert.match(managerApprovedNfcMigration, /'affiliationActivated', false/);
  assert.match(managerApprovedNfcMigration, /'profileActivated', false/);
  assert.match(managerApprovedNfcMigration, /case when v_shift_checked_in then 'shift_checked_in' else 'opened' end/);
  assert.doesNotMatch(managerApprovedNfcMigration, /insert into public\.notifications/);
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
