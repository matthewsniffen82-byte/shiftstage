import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  deals,
  redemptionRoute,
  dealCard,
  passPage,
  venuePage,
  venueDirectory,
  dancerPage,
  tvSource,
  tvClient,
  discoveryRoute,
  customerSavedRoute,
  customerDashboard,
  liveApp,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/pass/[token]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/saved/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("dancer-attributed Club Deals require a verified active check-in at generation and redemption", () => {
  assert.match(deals, /export async function dancerHasVerifiedActiveCheckInAtVenue/);
  assert.match(
    deals,
    /\.not\("checked_in_at", "is", null\)[\s\S]*?\.is\("checked_out_at", null\)[\s\S]*?\.in\("location_status", \["location_confirmed", "club_confirmed"\]\)/,
  );
  assert.match(redemptionRoute, /dancerHasVerifiedActiveCheckInAtVenue\(admin, dancerId, venueId\)/);
  assert.match(redemptionRoute, /available from the dancer profile only during a verified check-in/);
  assert.match(
    deals,
    /redemption\.sourceType === "dancer_profile"[\s\S]*?dancerHasVerifiedActiveCheckInAtVenue\(client, redemption\.dancerId, redemption\.venueId\)[\s\S]*?status: "voided"/,
  );
  assert.match(deals, /ended when the verified check-in ended/);
  assert.match(passPage, /hasLiveDancerAttribution[\s\S]*?dancerHasVerifiedActiveCheckInAtVenue/);
  assert.match(passPage, /const qrDataUrl = isAvailable/);
});

test("venue pages and directory cards promote real active deals inside the canonical experience", () => {
  assert.match(venuePage, /permanentRedirect\(`\/\?\$\{query\.toString\(\)\}`\)/);
  assert.doesNotMatch(venuePage, /stickyCta|ClubDealCard/);
  assert.match(liveApp, /function venueOfferMarkup\(venue\)[\s\S]*?venue\?\.activeDeal[\s\S]*?id="club-deal"/);
  assert.match(liveApp, /clubDealCtaMarkup\(config, "venue-club-deal-cta"\)/);
  assert.match(venueDirectory, /getActiveClubDealsForVenues/);
  assert.match(venueDirectory, /venue\.activeDeal[\s\S]*?className="venue-card-deal"/);
  assert.match(venueDirectory, /href=\{`\/\?city=\$\{encodeURIComponent\(venue\.city\)\}&venue=\$\{encodeURIComponent\(venue\.slug\)\}#club-deal`\}/);
});

test("deal generation produces a durable pass with save and share actions", () => {
  assert.match(dealCard, /fetch\("\/api\/deals\/redemptions"/);
  assert.match(dealCard, /sessionId: readOrCreateDealSessionId\(\)/);
  assert.match(dealCard, /headers\.authorization = `Bearer \$\{session\.accessToken\}`/);
  assert.match(dealCard, />Save QR</);
  assert.match(dealCard, />Share</);
  assert.match(dealCard, />View later</);
  assert.match(dealCard, /`\/deals\/pass\/\$\{encodeURIComponent\(redemptionToken\)\}`/);
  assert.match(passPage, /Show this QR to venue staff/);
  assert.match(passPage, /\/deals\/redeem\/\$\{encodeURIComponent\(token\)\}/);
});

test("checked-in dancer profiles and MyDancr TV promote attributed deals without exposing future shifts", () => {
  assert.match(dancerPage, /\{activeShift \? \([\s\S]*?\{activeDeal \? \([\s\S]*?sourceType="dancer_profile"/);
  assert.match(dancerPage, /function isActiveNow[\s\S]*?Boolean\(shift\.checkedInAt\)[\s\S]*?!shift\.checkedOutAt/);
  assert.doesNotMatch(dancerPage, /autoGenerate/);
  assert.match(tvSource, /video\.shift\?\.isActive && video\.venue/);
  assert.match(tvSource, /deal: video\.shift\?\.isActive && video\.venue/);
  assert.match(tvClient, /video\.shift\?\.isActive && video\.venue && video\.deal/);
  assert.match(tvClient, /sourceType="dancer_profile"/);
  assert.match(tvClient, /presentation="launcher"/);
});

test("homepage live profiles use the server-generated revenue QR only while Working Now", () => {
  assert.match(discoveryRoute, /activeDeal: activeDeals\.get\(venue\.id\) \|\| null/);
  assert.match(discoveryRoute, /activeDeal: dancer\.venueId \? activeDeals\.get\(dancer\.venueId\) \|\| null : null/);
  assert.match(liveApp, /activeDeal: item\.activeDeal \|\| null/);
  assert.match(liveApp, /function profileDealTileMarkup\(profile\) \{\s*if \(!profile\?\.venue \|\| !isWorkingTonight\(profile\)\) return ""/);
  assert.match(liveApp, /profile\.activeDeal && profile\.venueId/);
  assert.match(liveApp, /data-club-deal-cta/);
  assert.match(liveApp, /postOptionalAuthJson\("\/api\/deals\/redemptions"/);
  assert.match(liveApp, /sourceType: "dancer_profile"/);
});

test("signed-in customer deal passes are attached to the real account dashboard", () => {
  assert.match(redemptionRoute, /const customerId = await optionalCustomerId\(request, admin\)/);
  assert.match(redemptionRoute, /data\?\.role === "customer" && data\?\.account_state === "active"/);
  assert.match(deals, /export async function getCustomerDealRedemptions/);
  assert.match(customerSavedRoute, /getCustomerDealRedemptions\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.match(customerDashboard, /function CustomerDealPassPanel/);
  assert.match(customerDashboard, /href=\{`\/deals\/pass\/\$\{encodeURIComponent\(item\.redemptionToken\)\}`\}/);
  assert.match(customerDashboard, /Open QR/);
});
