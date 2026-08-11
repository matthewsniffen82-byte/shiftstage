import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [baseMigration, nfcCheckInMigration, adminMigration, service, tapRoute, tagRoute, adminRoute, client, account, dashboardRoute, dealCard, retiredDealQr] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110002_dressing_room_nfc_checkins.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090005_admin_nfc_provisioning.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/route.ts", import.meta.url), "utf8"),
]);

test("NFC stickers retain only high-entropy digests and remain MyDancr-provisioned", () => {
  assert.match(baseMigration, /create table if not exists public\.nfc_tags/);
  assert.match(baseMigration, /token_digest text not null unique/);
  assert.doesNotMatch(baseMigration, /raw_token|token_plaintext/);
  assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.match(adminMigration, /rotate_admin_venue_nfc_tag/);
  assert.match(adminRoute, /requireAdmin/);
  assert.match(tagRoute, /MyDancr supplies and programs venue NFC stickers/);
  assert.doesNotMatch(tagRoute, /setVenueNfcTagStatus/);
});

test("a dressing-room tap authorizes the venue and renews a current shift for no more than five hours", () => {
  assert.match(nfcCheckInMigration, /approve_dancer_venue_affiliation_from_nfc/);
  assert.match(nfcCheckInMigration, /insert into public\.venue_dancer_affiliations/);
  assert.match(nfcCheckInMigration, /on conflict \(venue_id, dancer_id\) do update/);
  assert.match(nfcCheckInMigration, /least\(v_shift\.ends_at, v_now \+ interval '5 hours'\)/);
  assert.match(nfcCheckInMigration, /checked_in_at = v_now/);
  assert.match(nfcCheckInMigration, /checked_out_at = null/);
  assert.match(nfcCheckInMigration, /location_status = 'club_confirmed'/);
  assert.match(nfcCheckInMigration, /venue_affiliation_id = v_affiliation\.id/);
  assert.match(nfcCheckInMigration, /checkin_latitude = null/);
  assert.match(nfcCheckInMigration, /drop function if exists public\.check_in_manager_approved_dancer_from_nfc/);
  assert.doesNotMatch(nfcCheckInMigration, /if found and v_shift\.checked_in_at is null/);
});

test("new and existing dancers use the same saved NFC enrollment flow without manager QR approval", () => {
  assert.match(service, /register_dancer_nfc_enrollment/);
  assert.match(service, /finalize_pending_dancer_nfc_enrollment/);
  assert.match(service, /authorize_dancer_profile_from_nfc/);
  assert.match(tapRoute, /registerDancerFromNfc/);
  assert.doesNotMatch(tapRoute, /venue_dancer_affiliations/);
  assert.doesNotMatch(tapRoute, /manager must scan/i);
  assert.match(dashboardRoute, /finalizePendingDancerNfcEnrollment/);
  assert.match(account, /dressing-room tap is saved through account creation/i);
  assert.match(client, /autoSubmittedRef/);
  assert.match(client, /void submitTap\(\)/);
  assert.match(client, /mode=signup&venue_nfc=/);
  assert.match(client, /return_to=/);
});

test("cashier NFC preserves the selected Club Deal and current-shift attribution", () => {
  assert.match(baseMigration, /confirm_deal_redemption_from_nfc/);
  assert.match(baseMigration, /previous\.redeemed_at >= v_now - interval '24 hours'/);
  assert.match(baseMigration, /'source', 'cashier_nfc_tap'/);
  assert.match(tapRoute, /verifyDancerDealAttributionToken/);
  assert.match(tapRoute, /getVerifiedActiveCheckInAtVenue/);
  assert.match(dealCard, /mydancrPendingNfcDealV1/);
  assert.match(client, /readPendingDealIntent/);
  assert.match(client, /Redeem this Club Deal/);
  assert.match(retiredDealQr, /status: 410/);
});

test("NFC activity remains auditable without exposing reusable tokens", () => {
  assert.match(baseMigration, /create table if not exists public\.nfc_tap_events/);
  assert.match(baseMigration, /device_fingerprint text/);
  assert.match(nfcCheckInMigration, /tap_count = tap_count \+ 1/);
  assert.match(nfcCheckInMigration, /'method', 'dressing_room_nfc'/);
});
