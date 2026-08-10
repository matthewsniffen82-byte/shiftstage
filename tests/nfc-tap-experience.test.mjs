import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, nfcService, tapRoute, tagRoute, tapClient, accountClient, dashboardRoute, dealCard, legacyDancerQr, legacyDealQr] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/nfc-tags/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/venue-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/route.ts", import.meta.url), "utf8"),
]);

test("NFC tags store only high-entropy token digests and can be rotated or disabled by their venue owner", () => {
  assert.match(migration, /create table if not exists public\.nfc_tags/);
  assert.match(migration, /token_digest text not null unique/);
  assert.doesNotMatch(migration, /raw_token|token_plaintext/);
  assert.match(nfcService, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(nfcService, /createHash\("sha256"\)/);
  assert.match(nfcService, /requireOwnedVenue/);
  assert.match(migration, /create or replace function public\.rotate_venue_nfc_tag/);
  assert.match(tagRoute, /setVenueNfcTagStatus/);
  assert.match(tagRoute, /cache-control.*private, no-store/s);
});

test("one dressing-room tag supports new dancers, approved dancers, and deferred onboarding without a manager scan", () => {
  assert.match(migration, /create table if not exists public\.dancer_nfc_enrollments/);
  assert.match(migration, /register_dancer_nfc_enrollment/);
  assert.match(migration, /finalize_pending_dancer_nfc_enrollment/);
  assert.match(migration, /dancer\.status = 'approved'[\s\S]*dancer\.verification_status = 'approved'[\s\S]*dancer\.is_public = true/);
  assert.match(migration, /'enrollmentStatus', 'pending'/);
  assert.match(migration, /status = 'completed'/);
  assert.match(tapRoute, /account\?\.role !== "dancer"/);
  assert.match(tapRoute, /registerDancerFromNfc/);
  assert.match(accountClient, /venue_nfc/);
  assert.match(accountClient, /return_to/);
  assert.match(dashboardRoute, /finalizePendingDancerNfcEnrollment/);
  assert.match(legacyDancerQr, /}, 410\)/);
  assert.match(legacyDancerQr, /dressing-room NFC sticker/);
});

test("repeat dressing-room taps preserve the original affiliation and notify only on first activation", () => {
  assert.match(migration, /v_affiliation_activated boolean := false/);
  assert.match(migration, /select not exists \([\s\S]*affiliation\.status = 'active'[\s\S]*\) into v_affiliation_activated/);
  assert.match(migration, /then public\.venue_dancer_affiliations\.approved_at[\s\S]*else excluded\.approved_at/);
  assert.match(migration, /if v_affiliation_activated then[\s\S]*insert into public\.notifications/);
  assert.match(migration, /'affiliationActivated', v_affiliation_activated/);
  assert.match(migration, /when v_shift_checked_in then 'shift_checked_in'/);
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
