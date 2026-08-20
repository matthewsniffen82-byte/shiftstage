import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [baseMigration, nfcCheckInMigration, submissionGateMigration, activationMigration, adminMigration, service, tapRoute, redemptionAttribution, tagRoute, adminRoute, client, account, dashboardRoute, dealCard, retiredDealQr] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608090003_nfc_tap_experience.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608110002_dressing_room_nfc_checkins.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608140001_require_dancer_submission_before_nfc.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608150006_align_nfc_activation_with_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608090005_admin_nfc_provisioning.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nfc.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-attribution.ts", import.meta.url), "utf8"),
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

test("new and existing dancers use the same submitted-profile NFC flow without manager QR approval", () => {
  assert.match(service, /register_dancer_nfc_enrollment/);
  assert.match(service, /finalize_pending_dancer_nfc_enrollment/);
  assert.doesNotMatch(service, /authorize_dancer_profile_from_nfc/);
  assert.match(submissionGateMigration, /require_submitted_dancer_profile_for_active_affiliation/);
  assert.match(submissionGateMigration, /v_profile_status not in \('pending_review', 'approved'\)/);
  assert.match(submissionGateMigration, /Submit your completed profile before using dressing-room NFC/);
  assert.match(tapRoute, /registerDancerFromNfc/);
  assert.doesNotMatch(tapRoute, /venue_dancer_affiliations/);
  assert.doesNotMatch(tapRoute, /manager must scan/i);
  assert.match(dashboardRoute, /finalizePendingDancerNfcEnrollment/);
  assert.match(account, /dressing-room tap is saved through account creation/i);
  assert.match(client, /autoSubmittedRef/);
  assert.match(client, /void submitTap\(\)/);
  assert.match(client, /mode=signup&venue_nfc=/);
  assert.match(client, /return_to=/);
  assert.match(client, /enrollmentStatus === "completed"/);
  assert.match(client, /window\.location\.replace\("\/dashboard\/dancer\?nfc=complete"\)/);
});

test("Step 3 eligibility matches the submitted onboarding requirements", () => {
  assert.match(activationMigration, /create or replace function public\.approve_dancer_venue_affiliation_from_nfc/);
  assert.match(activationMigration, /create or replace function public\.register_dancer_nfc_enrollment/);
  assert.match(activationMigration, /dancer\.status = 'pending_review'/);
  assert.match(activationMigration, /nullif\(trim\(dancer\.avatar_storage_path\), ''\) is not null/);
  assert.match(activationMigration, /photo\.review_status = 'approved'/);
  assert.doesNotMatch(activationMigration, /photo_review_status <> 'approved'/);
  assert.doesNotMatch(activationMigration, /photo\.review_status <> 'approved'/);
  assert.doesNotMatch(activationMigration, /video\.status in \('uploading', 'moderating', 'submitted'\)/);
});

test("dressing-room completion is reconciled before Done returns to the dashboard", () => {
  assert.match(client, /fetch\("\/api\/dancer\/dashboard", \{/);
  assert.match(client, /verification\.nfc\?\.profileAuthorization\?\.authorized === true/);
  assert.match(client, /setDancerActivationComplete\(completedDancerTap\)/);
  assert.match(client, /dancerActivationComplete \? "\/dashboard\/dancer\?nfc=complete"/);
});

test("failed NFC taps always provide a clear mobile escape route", () => {
  assert.match(client, /const exitHref = auth\.role === "dancer" \? "\/dashboard\/dancer" : "\/"/);
  assert.match(client, /<a className="nfc-exit"[\s\S]*?aria-label=\{exitLabel\}/);
  assert.match(client, /phase === "error" && !complete[\s\S]*?\{exitLabel\}/);
  assert.match(client, /phase === "error"[\s\S]*?"Try again"/);
  assert.match(client, /Profile activation was not completed\. Step 3 remains open/);
  assert.match(client, /\.nfc-exit\{[\s\S]*?width:48px;height:48px[\s\S]*?border-radius:50%/);
});

test("NFC exits use native navigation so mobile browsers can leave immediately", () => {
  assert.doesNotMatch(client, /<Link className="nfc-exit"/);
  assert.match(client, /complete \? \([\s\S]*?<a[\s\S]*?className="nfc-secondary"[\s\S]*?>[\s\S]*?Done[\s\S]*?<\/a>/);
});

test("dressing-room authentication stays venue-aware and dancer-only", () => {
  assert.match(account, /fetch\(`\/api\/nfc\/\$\{encodeURIComponent\(venueNfcToken\)\}`/);
  assert.match(account, /Verified dressing-room NFC/);
  assert.match(account, /Connect to \{nfcVenueName\}/);
  assert.match(account, /Venue affiliation activates automatically/);
  assert.match(account, /isNfcAuth \? \(\s*<div className="nfc-dancer-lock"/);
  assert.match(account, /Back to venue tap/);
  assert.match(account, /router\.push\(safeReturnTo \|\| destination\)/);
});

test("the NFC confirmation lands once without recentering or horizontal overflow", () => {
  assert.match(client, /\.nfc-page\{[^}]*align-content:start;justify-items:center/);
  assert.match(client, /\.nfc-page\{[^}]*overflow-anchor:none/);
  assert.doesNotMatch(client, /\.nfc-page\{[^}]*place-content:center/);
  assert.match(client, /\.nfc-card\{[^}]*max-width:100%[^}]*box-sizing:border-box/);
  assert.match(client, /\.nfc-card\{[^}]*overflow-anchor:none/);
});

test("cashier NFC preserves the selected Club Deal and current-shift attribution", () => {
  assert.match(baseMigration, /confirm_deal_redemption_from_nfc/);
  assert.match(baseMigration, /previous\.redeemed_at >= v_now - interval '24 hours'/);
  assert.match(baseMigration, /'source', 'cashier_nfc_tap'/);
  assert.match(tapRoute, /resolveDealRedemptionAttribution/);
  assert.match(redemptionAttribution, /verifyDancerDealAttributionToken/);
  assert.match(redemptionAttribution, /getVerifiedActiveCheckInAtVenue/);
  assert.match(dealCard, /mydancrPendingNfcDealV2/);
  assert.match(client, /readPendingDealIntent/);
  assert.match(client, /Redeem this Club Deal/);
  assert.match(retiredDealQr, /status: 410/);
});

test("Club Deal checkout explains the complete NFC tap flow without requiring an open browser", () => {
  assert.match(dealCard, /Use this deal/);
  assert.match(dealCard, /Tap &ldquo;Use this deal&rdquo; below/);
  assert.match(dealCard, /Go to the cashier/);
  assert.match(dealCard, /Unlock and tap the MyDancr NFC sticker/);
  assert.match(dealCard, /Confirm redemption/);
  assert.match(dealCard, /After selecting, MyDancr does not need to stay open\. Only this venue’s registered NFC sticker can complete redemption\./);
  assert.match(dealCard, /MyDancr does not need to stay open\. At the cashier, unlock your phone and hold it near the registered MyDancr NFC sticker\. The confirmation page will open automatically\./);
  assert.match(dealCard, /intentState === "ready" \? "Deal selected ✓"/);
  assert.match(dealCard, /intentState !== "ready"/);
  assert.doesNotMatch(dealCard, /<strong>Tap cashier sticker<\/strong>|Select before you reach the cashier\./);
  assert.match(dealCard, /Saved for later on this device\. This does not select or redeem the deal\./);
});

test("Club Deal checkout is the prominent violet action and confirms readiness in green", () => {
  assert.match(dealCard, /className=\{`club-deal-checkout-action\$\{intentState === "ready" \? " is-ready" : ""\}`\}/);
  assert.match(dealCard, /\.club-deal-dialog \.club-deal-checkout-action \{[^}]*min-height:52px !important;[^}]*background:linear-gradient\(135deg,#5b21b6 0%,#7c3aed 52%,#8b5cf6 100%\) !important;[^}]*0 0 26px rgba\(124,58,237,\.42\)/);
  assert.match(dealCard, /\.club-deal-dialog \.club-deal-checkout-action\.is-ready:disabled \{[^}]*opacity:1 !important;[^}]*background:linear-gradient\(135deg,#087443 0%,#0f9f5b 58%,#16a34a 100%\) !important;[^}]*0 0 24px rgba\(34,197,94,\.34\)/);
  assert.match(dealCard, /\.club-deal-primary-dock \{ position:static;[^}]*width:100%;[^}]*margin-top:0;[^}]*transform:none;/);
});

test("NFC activity remains auditable without exposing reusable tokens", () => {
  assert.match(baseMigration, /create table if not exists public\.nfc_tap_events/);
  assert.match(baseMigration, /device_fingerprint text/);
  assert.match(nfcCheckInMigration, /tap_count = tap_count \+ 1/);
  assert.match(nfcCheckInMigration, /'method', 'dressing_room_nfc'/);
});
