import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [deals, tapRoute, dealCard, passPage, venuePage, venueDirectory, dancerPage, tvSource, tvClient, discoveryRoute, customerDashboard, liveApp, retiredPassRoute, retiredVenueQrRoute, dealCopy, demoDeals] = await Promise.all([
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
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
]);

test("dancer-attributed cashier taps require a verified current shift and preserve locked attribution", () => {
  assert.match(deals, /export async function getVerifiedActiveCheckInAtVenue/);
  assert.match(tapRoute, /verifyDancerDealAttributionToken/);
  assert.match(tapRoute, /attribution\.dancerId !== dancerId/);
  assert.match(tapRoute, /attribution\.venueId !== tag\.venueId/);
  assert.match(tapRoute, /attribution\.dealId !== dealId/);
  assert.match(tapRoute, /verifiedCheckIn\.shiftId !== attribution\.shiftId/);
  assert.match(tapRoute, /campaignSource: "venue_nfc"/);
});

test("Club Deal selection snapshots customer-facing terms before atomic NFC confirmation", () => {
  assert.match(tapRoute, /dealTitle: deal\.dealTitle/);
  assert.match(tapRoute, /dealDescription: deal\.dealDescription/);
  assert.match(tapRoute, /dealTerms: deal\.dealTerms/);
  assert.match(tapRoute, /dealOfferType: deal\.offerType/);
  assert.match(tapRoute, /confirmRedemptionFromNfc/);
  assert.match(deals, /issuedDealSnapshot/);
  assert.match(deals, /readIssuedDealSnapshot/);
  assert.match(deals, /dealSnapshot \? dealSnapshot\.dealTitle/);
  assert.match(deals, /dealSnapshot \? dealSnapshot\.dealTerms/);
  assert.match(passPage, /Legacy Club Deal pass/);
});

test("venue pages, venue cards, dancer profiles, and TV expose real active Club Deals", () => {
  assert.match(venuePage, /getVenueProfile/);
  assert.match(venuePage, /permanentRedirect/);
  assert.match(venueDirectory, /permanentRedirect/);
  assert.match(dancerPage, /ctaLabel="Club Deals"/);
  assert.match(tvSource, /deals: venueDeals/);
  assert.match(tvSource, /dealAttributionToken/);
  assert.match(tvClient, /ClubDealCard/);
  assert.match(discoveryRoute, /activeDeals/);
});

test("venue, dancer, and TV cards label active and inactive NFC actions clearly", () => {
  assert.match(liveApp, /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?data-club-deal-state="available"[\s\S]*?actionButtonLabel\("qr", "Deals"\)[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?actionButtonLabel\("qr", "Deals"\)/);
  assert.match(liveApp, /function homeDancerGridQrMarkup\(profile\)[\s\S]*?data-card-qr-label[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)[\s\S]*?data-club-deal-state="available"[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)/);
  assert.match(liveApp, /function homeTvFeedDealState\(item\)[\s\S]*?key: "no-active-offer"[\s\S]*?key: "available-when-working"[\s\S]*?key: "not-available-now"/);
  assert.match(liveApp, /deal\.dataset\.cardQrLabel = dealState\.label[\s\S]*?deal\.dataset\.cardQrMessage = dealState\.detail/);
  assert.match(liveApp, /home-tv-feed-deal-count">Deals/);
  assert.match(tvClient, /<TvClubDealUnavailable video=\{video\} \/>/);
  assert.match(tvClient, /<small>Club Deals<\/small>/);
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

test("Club Deal checkout uses one concise four-step NFC flow across both public experiences", () => {
  for (const source of [dealCard, liveApp]) {
    assert.match(source, /<strong>Press Use this deal<\/strong>/);
    assert.match(source, /At cashier, unlock your phone/);
    assert.match(source, /Tap the registered NFC sticker/);
    assert.match(source, /<strong>Confirm redemption<\/strong>/);
    assert.match(source, /Selecting does not redeem it/);
    assert.match(source, /Save for later/);
    assert.match(source, /Tap cashier sticker/);
    assert.match(source, /Only the venue’s registered sticker can redeem it/);
  }
  assert.match(dealCard, /status && intentState !== "preview"/);
  assert.match(liveApp, /status\.hidden = state === "preview"/);
  assert.match(dealCopy, /Cashier NFC confirmation is required/);
  assert.match(dealCard, /customerFacingDealTerms\(activeDeal\.dealTerms\)/);
  assert.match(liveApp, /customerFacingDealTerms\(pass\.terms\)/);
  assert.doesNotMatch(demoDeals, /terms: .*Cashier NFC confirmation is required/);
});

test("selected Club Deals replace preparation controls with one cashier instruction", () => {
  const cashierInstruction = /At the cashier, unlock your phone, tap the registered MyDancr NFC sticker, then confirm redemption\./;

  assert.match(dealCard, cashierInstruction);
  assert.match(dealCard, /intentState !== "ready" \? \([\s\S]*?club-deal-redemption-steps/);
  assert.match(dealCard, /dialogOpen && intentState !== "ready"/);
  assert.match(dealCard, /intentState !== "ready" \? <small>Selecting does not redeem it\.<\/small> : null/);
  assert.match(dealCard, /intentState === "ready" \? "Ready to Tap"/);

  assert.match(liveApp, cashierInstruction);
  assert.match(liveApp, /\.deal-pass-sheet\[data-deal-state="ready"\] \.deal-pass-steps,[\s\S]*?\.deal-pass-security,[\s\S]*?\.deal-pass-actions \{\s*display: none;/);
  assert.match(liveApp, /primaryNote\.hidden = true/);
  assert.match(liveApp, /selectButton\.textContent = "Ready to Tap"/);
});

test("mobile Club Deal checkout fits the complete cashier flow into the phone viewport", () => {
  assert.match(liveApp, /width: min\(370px, calc\(100vw - 16px\)\)/);
  assert.match(liveApp, /max-height: calc\(100dvh - 16px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(liveApp, /padding: 12px 12px calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(liveApp, /@media \(max-width: 560px\) \{[\s\S]*?\.deal-pass-step \{[\s\S]*?grid-template-columns: 18px minmax\(0, 1fr\);[\s\S]*?padding: 4px 6px;[\s\S]*?\.deal-pass-action \{[\s\S]*?min-height: 38px !important;/);
  assert.match(dealCard, /\.club-deal-dialog \{ width:min\(370px,100%\); max-height:calc\(100dvh - 16px/);
  assert.match(dealCard, /\.club-deal-primary-dock \{ width:min\(370px,calc\(100vw - 16px\)\); bottom:max\(8px,env\(safe-area-inset-bottom\)\)/);
});

test("cashier NFC mark is explicitly centered and visually emphasized", () => {
  assert.match(liveApp, /\.deal-pass-frame \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-auto-rows: max-content;/);
  assert.match(liveApp, /\.deal-pass-frame \.deal-pass-nfc-symbol \.club-deal-qr-symbol \{[\s\S]*?display: grid;[\s\S]*?place-items: center;[\s\S]*?filter: drop-shadow/);
  assert.match(liveApp, /\.deal-pass-frame \.deal-pass-nfc-symbol \.club-deal-qr-symbol svg \{[\s\S]*?display: block;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
  assert.match(liveApp, /border: 1px solid rgba\(126, 234, 255, \.72\);[\s\S]*?0 0 16px rgba\(53, 216, 255, \.34\)/);
  assert.match(dealCard, /\.club-deal-nfc-symbol svg \{[\s\S]*?display:block;[\s\S]*?place-self:center;[\s\S]*?rgba\(126,234,255,\.72\)/);
});

test("multiple live non-alcohol offers stay selectable without external liquor booking handoffs", () => {
  assert.match(dealCard, /offerDeals\.map/);
  assert.match(dealCard, /selectedDealId/);
  assert.doesNotMatch(dealCard, /bottle_service|activeDeal\.bookingUrl|Continue to club booking/);
});

test("the canonical live shell uses cashier NFC instead of generating customer QR images", () => {
  assert.match(liveApp, /mydancrPendingNfcDealV2/);
  assert.match(liveApp, /Use at the cashier/);
  assert.match(liveApp, /tap the venue’s registered MyDancr NFC sticker/i);
  assert.doesNotMatch(liveApp, /fetch\("\/api\/deals\/redemptions",\s*\{\s*method:\s*"POST"/);
  assert.doesNotMatch(liveApp, /<img src="\$\{pass\.qrImageUrl\}"/);
});

test("signed-in customer dashboards retain saved Club Deal state without owning redemption", () => {
  assert.match(customerDashboard, /CustomerDealPassPanel/);
  assert.match(customerDashboard, /dealRedemptions/);
  assert.match(liveApp, /Saved Club Deals/);
  assert.match(liveApp, /No saved Club Deals yet/);
  assert.match(liveApp, /Save a Club Deal to find it here later/);
  assert.doesNotMatch(liveApp, /Tap a QR to enlarge it and show it at the club/);
  assert.doesNotMatch(liveApp, /Saved Club Deals will appear here after you choose an offer/);
});

test("legacy QR issuance endpoints are explicitly retired instead of silently accepting writes", () => {
  assert.match(retiredPassRoute, /status: 410/);
  assert.match(retiredPassRoute, /cashier NFC sticker/);
  assert.match(retiredVenueQrRoute, /status: 410/);
  assert.match(retiredVenueQrRoute, /NFC stickers/);
});
