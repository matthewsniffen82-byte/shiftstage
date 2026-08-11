import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [deals, tapRoute, dealCard, passPage, venuePage, venueDirectory, dancerPage, tvSource, tvClient, discoveryRoute, customerDashboard, liveApp, retiredPassRoute, retiredVenueQrRoute] = await Promise.all([
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

test("venue, dancer, and TV cards label active and inactive NFC actions as Club Deals", () => {
  assert.match(liveApp, /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?data-club-deal-state="available"[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)/);
  assert.match(liveApp, /function homeDancerGridQrMarkup\(profile\)[\s\S]*?data-card-qr-label[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)[\s\S]*?data-club-deal-state="available"[\s\S]*?actionButtonLabel\("qr", "Club Deals"\)/);
  assert.match(liveApp, /function homeTvFeedDealState\(item\)[\s\S]*?key: "no-active-offer"[\s\S]*?key: "available-when-working"[\s\S]*?key: "not-available-now"/);
  assert.match(liveApp, /deal\.dataset\.cardQrLabel = dealState\.label[\s\S]*?deal\.dataset\.cardQrMessage = dealState\.detail/);
  assert.match(liveApp, /home-tv-feed-deal-count">Club Deals/);
  assert.match(tvClient, /<TvClubDealUnavailable video=\{video\} \/>/);
  assert.match(tvClient, /<small>Club Deals<\/small>/);
  assert.match(dealCard, /<strong>Club Deals<\/strong>/);
  assert.doesNotMatch(liveApp, /actionButtonLabel\("qr", "NFC(?: Deal)?"\)|home-tv-feed-deal-count">NFC/);
});

test("customers save an exact offer and dancer token locally until the physical cashier tap", () => {
  assert.match(dealCard, /mydancrPendingNfcDealV1/);
  assert.match(dealCard, /dealId: activeDeal\.id/);
  assert.match(dealCard, /sourceType/);
  assert.match(dealCard, /dancerId: sourceType === "dancer_profile"/);
  assert.match(dealCard, /attributionTokens\?\.\[activeDeal\.id\]/);
  assert.match(dealCard, /Tap the MyDancr NFC sticker at the cashier to redeem/);
  assert.doesNotMatch(dealCard, /QRCode\.toDataURL|import QRCode/);
});

test("multiple live offers stay selectable and bottle service keeps its real booking handoff", () => {
  assert.match(dealCard, /offerDeals\.map/);
  assert.match(dealCard, /selectedDealId/);
  assert.match(dealCard, /activeDeal\.offerType === "bottle_service"/);
  assert.match(dealCard, /activeDeal\.bookingUrl/);
  assert.match(dealCard, /Continue to club booking/);
});

test("the canonical live shell uses cashier NFC instead of generating customer QR images", () => {
  assert.match(liveApp, /mydancrPendingNfcDealV1/);
  assert.match(liveApp, /Cashier NFC redemption/);
  assert.match(liveApp, /tap the cashier NFC sticker at the club/i);
  assert.doesNotMatch(liveApp, /fetch\("\/api\/deals\/redemptions",\s*\{\s*method:\s*"POST"/);
  assert.doesNotMatch(liveApp, /<img src="\$\{pass\.qrImageUrl\}"/);
});

test("signed-in customer dashboards retain saved Club Deal state without owning redemption", () => {
  assert.match(customerDashboard, /CustomerDealPassPanel/);
  assert.match(customerDashboard, /dealRedemptions/);
  assert.match(liveApp, /Saved Club Deals/);
  assert.match(liveApp, /Redeem by tapping the club cashier NFC sticker/);
});

test("legacy QR issuance endpoints are explicitly retired instead of silently accepting writes", () => {
  assert.match(retiredPassRoute, /status: 410/);
  assert.match(retiredPassRoute, /cashier NFC sticker/);
  assert.match(retiredVenueQrRoute, /status: 410/);
  assert.match(retiredVenueQrRoute, /NFC stickers/);
});
