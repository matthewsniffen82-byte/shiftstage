import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [deals, dealRedemptionActions, tapRoute, cashierRedemption, redemptionAttribution, dealCard, passPage, venuePage, venueDirectory, dancerPage, tvSource, tvClient, discoveryRoute, customerDashboard, liveApp, retiredPassRoute, retiredVenueQrRoute, dealCopy, demoDeals, atomicNfcMigration] = await Promise.all([
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/cashier-deal-redemption.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-attribution.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/pass/[token]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/qr/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-copy.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/manage-demo-club-deals.mjs", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608190001_phase_zero_atomic_nfc_redemption.sql", import.meta.url), "utf8"),
]);

test("dancer-attributed cashier taps require a verified current shift and preserve locked attribution", () => {
  assert.match(deals, /export async function getVerifiedActiveCheckInAtVenue/);
  assert.match(tapRoute, /completeCashierDealRedemption/);
  assert.match(cashierRedemption, /resolveDealRedemptionAttribution/);
  assert.doesNotMatch(tapRoute, /verifyDancerDealAttributionToken|getVerifiedActiveCheckInAtVenue/);
  assert.match(redemptionAttribution, /verifyDancerDealAttributionToken/);
  assert.match(redemptionAttribution, /attribution\.dancerId !== dancerId/);
  assert.match(redemptionAttribution, /attribution\.venueId !== input\.venueId/);
  assert.match(redemptionAttribution, /attribution\.dealId !== input\.dealId/);
  assert.match(redemptionAttribution, /verifiedCheckIn\.shiftId !== attribution\.shiftId/);
  assert.match(cashierRedemption, /campaignSource: "venue_nfc"/);
});

test("Club Deal selection snapshots customer-facing terms before atomic NFC confirmation", () => {
  assert.match(cashierRedemption, /dealTitle: deal\.dealTitle/);
  assert.match(cashierRedemption, /dealDescription: deal\.dealDescription/);
  assert.match(cashierRedemption, /dealTerms: deal\.dealTerms/);
  assert.match(cashierRedemption, /dealOfferType: deal\.offerType/);
  assert.match(cashierRedemption, /issueAndConfirmDealRedemptionFromNfc/);
  assert.doesNotMatch(tapRoute, /createDealRedemption|confirmRedemptionFromNfc|status: "voided"/);
  assert.match(dealRedemptionActions, /rpc\("issue_and_confirm_deal_redemption_from_nfc"/);
  assert.match(atomicNfcMigration, /insert into public\.qr_redemptions/);
  assert.match(atomicNfcMigration, /public\.confirm_deal_redemption_from_nfc/);
  assert.match(atomicNfcMigration, /grant execute[\s\S]*to service_role/);
  assert.match(tapRoute, /resolveApiError\(error, "Unable to complete this phone tap\.", status\)/);
  assert.doesNotMatch(tapRoute, /NextResponse\.json\(\{ ok: false, error: message/);
  assert.match(dealRedemptionActions, /issuedDealSnapshot/);
  assert.match(deals, /readIssuedDealSnapshot/);
  assert.match(deals, /dealSnapshot \? dealSnapshot\.dealTitle/);
  assert.match(deals, /dealSnapshot \? dealSnapshot\.dealTerms/);
  assert.match(passPage, /Legacy Club Deal pass/);
});

test("venue pages, venue cards, dancer profiles, and TV expose real active Club Deals", () => {
  assert.match(venuePage, /getVenueProfile/);
  assert.match(venuePage, /permanentRedirect/);
  assert.match(venueDirectory, /permanentRedirect/);
  assert.match(dancerPage, /ctaLabel=\{activeDeals\.length > 1 \? "Club Deals" : "Club Deal"\}/);
  assert.doesNotMatch(dealCard, /<em>\{offerDeals\.length > 1 \? "Tap to choose an offer and view instructions" : "Tap How to use for instructions"\}<\/em>/);
  assert.match(tvSource, /deals: venueDeals/);
  assert.match(tvSource, /dealAttributionToken/);
  assert.match(tvClient, /ClubDealCard/);
  assert.match(discoveryRoute, /activeDeals/);
});

test("venue and dancer cards consistently label Club Deal states while TV renders only an active action", () => {
  assert.match(liveApp, /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?data-club-deal-state="available"[\s\S]*?actionButtonLabel\("qr", offerCount > 1 \? "Club Deals" : "Club Deal"\)[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)/);
  assert.match(liveApp, /function homeDancerGridQrMarkup\(profile\)[\s\S]*?data-card-qr-label[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)[\s\S]*?data-club-deal-state="available"[\s\S]*?actionButtonLabel\("qr", qr\.offerCount > 1 \? "Club Deals" : "Club Deal"\)/);
  assert.match(liveApp, /function homeTvFeedDealState\(item\)[\s\S]*?key: "no-active-offer"[\s\S]*?key: "available-when-working"[\s\S]*?key: "not-available-now"/);
  assert.match(liveApp, /let deal = null;[\s\S]*?if \(dealState\.key === "available"\)/);
  assert.doesNotMatch(liveApp, /deal\.dataset\.cardQrLabel|deal\.dataset\.cardQrMessage/);
  assert.match(liveApp, /home-tv-feed-deal-count">\$\{offerCount > 1 \? "Club Deals" : "Club Deal"\}/);
  assert.doesNotMatch(tvClient, /TvClubDealUnavailable|tv-club-deal-unavailable/);
  assert.match(dealCard, /<strong>Club Deals<\/strong>/);
  assert.doesNotMatch(liveApp, /actionButtonLabel\("qr", "NFC(?: Deal)?"\)|home-tv-feed-deal-count">NFC/);
});

test("customers explicitly select an exact offer and dancer token until the physical cashier tap", () => {
  assert.match(dealCard, /mydancrPendingNfcDealV2/);
  assert.match(dealCard, /dealId: activeDeal\.id/);
  assert.match(dealCard, /sourceType/);
  assert.match(dealCard, /dancerId: sourceType === "dancer_profile"/);
  assert.match(dealCard, /attributionTokens\?\.\[activeDeal\.id\]/);
  assert.doesNotMatch(dealCard, /Preview only—select this deal before tapping the cashier NFC sticker/);
  assert.match(dealCard, /setIntentState\("ready"\)/);
  assert.doesNotMatch(dealCard, /QRCode\.toDataURL|import QRCode/);
});

test("Club Deal checkout uses a short cashier instruction across both public experiences", () => {
  for (const source of [dealCard, liveApp]) {
    assert.match(source, /When you reach the cashier, unlock your phone and hold it near the MyDancr sticker/);
    assert.match(source, /Use free admission/);
    assert.doesNotMatch(source, /<strong>Tap &ldquo;Use this deal&rdquo;<\/strong>/);
    assert.doesNotMatch(source, /Only this venue’s registered cashier sticker can complete redemption/);
  }
  assert.match(dealCopy, /Cashier NFC confirmation is required/);
  assert.match(dealCard, /customerFacingDealTerms\(activeDeal\.dealTerms\)/);
  assert.match(liveApp, /customerFacingDealTerms\(pass\.terms\)/);
  assert.doesNotMatch(demoDeals, /terms: .*Cashier NFC confirmation is required/);
});

test("selected Club Deals show a pending tap without a misleading success button", () => {
  for (const source of [dealCard, liveApp]) {
    assert.match(source, /Ready for your cashier tap/);
    assert.match(source, /When you reach the cashier, unlock your phone and hold it near the MyDancr sticker/);
    assert.doesNotMatch(source, /Ready at Cashier ✓/);
  }
  const readyMarkup = dealCard.match(/const dialogContent = intentState === "ready" \?([\s\S]*?)\) : \(/)?.[1] || "";
  assert.match(readyMarkup, /club-deal-ready-instructions/);
  assert.doesNotMatch(readyMarkup, /<button|club-deal-primary-dock/);
  assert.match(liveApp, /availableContent\.hidden = state === "ready"/);
  assert.match(liveApp, /readyContent\.hidden = state !== "ready"/);
  assert.match(liveApp, /primaryDock\.hidden = state === "ready"/);
});

test("mobile Club Deal checkout fits the complete cashier flow into the phone viewport", () => {
  assert.match(liveApp, /width: min\(380px, calc\(100vw - 16px\)\)/);
  assert.match(liveApp, /max-height: calc\(100dvh - 16px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(liveApp, /overflow-x: hidden;/);
  assert.match(dealCard, /\.club-deal-dialog \{ position: relative; width: min\(400px, 100%\);[\s\S]*?overflow-x:hidden;/);
});

test("Club Deal optional data collapses and complete terms expand accessibly", () => {
  assert.match(dealCard, /displayDescription \? <p>\{displayDescription\}<\/p> : null/);
  assert.match(dealCard, /displayDescription \|\| displayTerms \? \(/);
  assert.match(dealCard, /aria-expanded=\{termsExpanded\}/);
  assert.match(dealCard, /id=\{termsId\} hidden=\{!termsExpanded\}/);
  assert.match(liveApp, /offerElement\.hidden = termsButton\.hidden/);
  assert.match(liveApp, /termsButton\.hidden = !description && !terms && !presentation\.attribution/);
  assert.match(liveApp, /button\.setAttribute\("aria-expanded", String\(!expanded\)\)/);
  assert.match(liveApp, /terms\.hidden = expanded/);
});

test("pending cashier instructions retain a centered NFC mark", () => {
  assert.match(liveApp, /deal-pass-ready-instructions \.deal-pass-nfc-symbol \{[^}]*display: grid;[^}]*place-items: center/);
  assert.match(dealCard, /\.club-deal-nfc-symbol svg \{[\s\S]*?display:block;[\s\S]*?place-self:center/);
});

test("multiple live non-alcohol offers stay selectable without external liquor booking handoffs", () => {
  assert.match(dealCard, /offerDeals\.map/);
  assert.match(dealCard, /selectedDealId/);
  assert.doesNotMatch(dealCard, /bottle_service|activeDeal\.bookingUrl|Continue to club booking/);
});

test("the canonical live shell uses cashier NFC instead of generating customer QR images", () => {
  assert.match(liveApp, /mydancrPendingNfcDealV2/);
  assert.match(liveApp, /Ready for your cashier tap/);
  assert.match(liveApp, /When you reach the cashier, unlock your phone and hold it near the MyDancr sticker/);
  assert.doesNotMatch(liveApp, /fetch\("\/api\/deals\/redemptions",\s*\{\s*method:\s*"POST"/);
  assert.doesNotMatch(liveApp, /<img src="\$\{pass\.qrImageUrl\}"/);
});

test("signed-in customer dashboards retain saved Club Deal state without owning redemption", () => {
  assert.match(customerDashboard, /CustomerDealPassPanel/);
  assert.match(customerDashboard, /dealRedemptions/);
  assert.match(deals, /venues\(id, name, slug\)/);
  assert.match(liveApp, /Saved Club Deals/);
  assert.match(liveApp, /No saved Club Deals yet/);
  assert.match(liveApp, /Save a Club Deal to find it here later/);
  assert.match(liveApp, /mergeLiveCustomerDealPasses\(saved\?\.dealRedemptions\)/);
  assert.match(liveApp, /id="customerDealQuickCount"/);
  assert.match(liveApp, /id="customerDealQuickCta"[^>]*>New deal saved · Open</);
  assert.match(liveApp, /function unseenSavedDealCount\(\)/);
  assert.match(liveApp, /savedAt: existingSavedPass\?\.savedAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(liveApp, /classList\.toggle\("has-new-deal", hasNewDeal\)/);
  assert.match(liveApp, /function markSavedDealsSeen\(\)/);
  assert.match(liveApp, /customerDealQuickBtn\.setAttribute\("aria-expanded", "true"\);\s*markSavedDealsSeen\(\);/);
  assert.match(liveApp, /\.customer-deal-quick-cta \{/);
  assert.doesNotMatch(liveApp, /Tap a QR to enlarge it and show it at the club/);
  assert.doesNotMatch(liveApp, /Saved Club Deals will appear here after you choose an offer/);
});

test("legacy QR issuance endpoints are explicitly retired instead of silently accepting writes", () => {
  assert.match(retiredPassRoute, /status: 410/);
  assert.match(retiredPassRoute, /cashier sticker/);
  assert.match(retiredVenueQrRoute, /status: 410/);
  assert.match(retiredVenueQrRoute, /tap stickers/);
});
