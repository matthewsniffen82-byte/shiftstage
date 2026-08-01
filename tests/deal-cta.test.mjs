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
  venueQrComponent,
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
  readFile(new URL("../app/components/VenueQrCode.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("dancer-attributed Club Deals require a verified check-in at issue and preserve the locked attribution", () => {
  assert.match(deals, /export async function getVerifiedActiveCheckInAtVenue/);
  assert.match(
    deals,
    /\.not\("checked_in_at", "is", null\)[\s\S]*?\.is\("checked_out_at", null\)[\s\S]*?\.in\("location_status", \["location_confirmed", "club_confirmed"\]\)/,
  );
  assert.match(redemptionRoute, /getVerifiedActiveCheckInAtVenue\(admin, dancerId, venueId\)/);
  assert.match(redemptionRoute, /available from the dancer profile only during a verified check-in/);
  assert.match(redemptionRoute, /shiftId = verifiedCheckIn\.shiftId/);
  assert.match(deals, /shift_id: input\.sourceType === "dancer_profile" \? input\.shiftId/);
  assert.match(deals, /attribution_locked_at: input\.sourceType === "dancer_profile"/);
  assert.doesNotMatch(deals, /ended when the verified check-in ended/);
  assert.doesNotMatch(passPage, /hasLiveDancerAttribution|dancerHasVerifiedActiveCheckInAtVenue/);
  assert.match(passPage, /Dancer credit was locked when this QR was issued during a verified check-in/);
  assert.match(passPage, /const qrDataUrl = isAvailable/);
});

test("venue pages and directory cards promote real active deals", () => {
  assert.match(venuePage, /permanentRedirect/);
  assert.doesNotMatch(venuePage, /ClubDealCard|stickyCta/);
  assert.match(liveApp, /function venueOfferMarkup\(venue\)[\s\S]*?venue\?\.activeDeal[\s\S]*?id="club-deal"/);
  assert.match(liveApp, /clubDealCtaMarkup\(config, "venue-club-deal-cta"\)/);
  assert.match(
    venueDirectory,
    /permanentRedirect\(homeDiscoveryHref\("venues", params\.city\)\)/,
  );
  assert.doesNotMatch(venueDirectory, /getActiveClubDealsForVenues|venue-card-deal/);
  assert.match(
    liveApp,
    /function homeVenueDiscoveryQrMarkup\(venue, presentation = "primary"\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?data-club-deal-cta/,
  );
  const venueQrHelper =
    liveApp.match(
      /function homeVenueDiscoveryQrMarkup\(venue, presentation = "primary"\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
    )?.[0] || "";
  assert.match(
    venueQrHelper,
    /venue\?\.id && venue\.activeDeal\?\.id[\s\S]*?if \(rail\)[\s\S]*?home-card-qr-rail-action home-venue-discovery-rail-qr is-available[\s\S]*?data-card-action-slot="qr"[\s\S]*?home-venue-discovery-club-deal home-venue-discovery-deal-action is-available/,
  );
  assert.match(
    venueQrHelper,
    /clubDealQrSymbolMarkup\("home-venue-discovery-qr-symbol"\)[\s\S]*?<strong>Get Club Deal<\/strong>[\s\S]*?Open unique QR/,
  );
  assert.match(
    venueQrHelper,
    /home-venue-discovery-club-deal is-unavailable[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?<strong>No Club Deal<\/strong>[\s\S]*?Check back later/,
  );
  assert.doesNotMatch(
    venueQrHelper,
    /safeExternalHref\(venue\.qrCodeUrl\)|data-external-venue-qr|data-venue-profile-qr|publishedVenueQrPass|data-deal-pass/,
  );
  const venueOffer =
    liveApp.match(
      /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
    )?.[0] || "";
  assert.match(venueOffer, /venue-club-deal-unavailable[\s\S]*?Club Deal QR/);
  assert.match(
    venueOffer,
    /data-club-deal-state="available"[\s\S]*?clubDealQrSymbolMarkup\("venue-detail-club-deal-symbol"\)[\s\S]*?Unique tracked QR[\s\S]*?Opens after you tap Get Club Deal/,
  );
  assert.match(
    venueOffer,
    /data-club-deal-state="unavailable"[\s\S]*?clubDealQrSymbolMarkup\("venue-detail-club-deal-symbol"\)[\s\S]*?Club Deal QR[\s\S]*?Unavailable · Check back later/,
  );
  assert.match(liveApp, /\.venue-detail-club-deal-actions \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(190px, 230px\);/);
  assert.match(liveApp, /@media \(max-width: 520px\) \{[\s\S]*?\.venue-detail-club-deal-actions \{[\s\S]*?grid-template-columns: 1fr;/);
  assert.doesNotMatch(venueOffer, /data-venue-profile-qr|Show venue QR/);
  const venueSlide =
    liveApp.match(
      /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
    )?.[0] || "";
  assert.match(venueSlide, /const qrMarkup = homeVenueDiscoveryQrMarkup\(venue\)/);
  assert.doesNotMatch(venueSlide, /dealMarkup|home-venue-discovery-deal/);
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
  assert.match(dealCard, /\.club-deal-dialog-backdrop \{ position: fixed; z-index: 1700;/);
  assert.match(dealCard, /recordLifecycleEvent\(redemptionToken, "saved"\)/);
  assert.match(dealCard, /recordLifecycleEvent\(redemptionToken, "shared"\)/);
});

test("live venue QR sheet uses concise MyDancr labeling and mobile-safe actions", () => {
  assert.match(
    liveApp,
    /function dealPassPresentation\(pass\)[\s\S]*?kicker: "MyDancr Club Deal QR"[\s\S]*?`\$\{venueName\} · Valid tonight`[\s\S]*?status: dancerAttributed[\s\S]*?Attribution locked when issued[\s\S]*?: "Unique QR · Tracked for redemption"/,
  );
  assert.match(liveApp, /id="dealPassKicker"/);
  assert.match(liveApp, /data-save-deal-pass>Save QR</);
  assert.match(liveApp, /data-share-deal-pass>Share QR</);
  assert.match(liveApp, /class="deal-pass-action tertiary"[^>]*data-copy-deal-pass>Copy link</);
  assert.doesNotMatch(liveApp, /data-download-deal-pass/);
  assert.match(
    liveApp,
    /event\.target\.closest\("\[data-save-deal-pass\]"\)[\s\S]*?downloadDealQrImage\(pass\)/,
  );
  assert.match(
    liveApp,
    /\.deal-pass-sheet \{[\s\S]*?max-height: calc\(100dvh - 36px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\);[\s\S]*?overflow-y: auto;/,
  );
  assert.match(liveApp, /\.deal-pass-actions \{[\s\S]*?grid-template-columns: 1fr 1fr;/);
});

test("checked-in dancer profiles and MyDancr TV promote attributed deals without exposing future shifts", () => {
  assert.match(dancerPage, /\{activeShift \? \([\s\S]*?\{activeDeal \? \([\s\S]*?sourceType="dancer_profile"/);
  assert.match(dancerPage, /function isActiveNow[\s\S]*?Boolean\(shift\.checkedInAt\)[\s\S]*?!shift\.checkedOutAt/);
  assert.doesNotMatch(dancerPage, /autoGenerate/);
  assert.match(tvSource, /video\.shift\?\.isActive && video\.venue/);
  assert.match(tvSource, /const deal = video\.shift\?\.isActive && video\.venue/);
  assert.match(tvSource, /createDancerDealAttributionToken/);
  assert.match(tvClient, /video\.shift\?\.isActive && video\.venue && video\.deal/);
  assert.match(tvClient, /sourceType="dancer_profile"/);
  assert.match(tvClient, /attributionToken=\{video\.dealAttributionToken\}/);
  assert.match(tvClient, /presentation="launcher"/);
  assert.match(
    liveApp,
    /const hasLiveDeal = item\?\.shift\?\.isActive === true[\s\S]*?item\?\.venue\?\.id && item\?\.deal\?\.id && item\?\.dealAttributionToken[\s\S]*?deal\.dataset\.clubDealCta = encodeDealPass[\s\S]*?attributionToken: item\.dealAttributionToken/,
  );
  assert.match(liveApp, /deal\.dataset\.feedLiveQr = "true"/);
});

test("homepage live profiles use the server-generated revenue QR only while Working Now", () => {
  assert.match(discoveryRoute, /activeDeal: activeDeals\.get\(venue\.id\) \|\| null/);
  assert.match(discoveryRoute, /const activeDeal = dancer\.venueId \? activeDeals\.get\(dancer\.venueId\) \|\| null : null/);
  assert.match(discoveryRoute, /dealAttributionToken:[\s\S]*?createDancerDealAttributionToken/);
  assert.match(liveApp, /activeDeal: item\.activeDeal \|\| null/);
  assert.match(liveApp, /dealAttributionToken: item\.dealAttributionToken \|\| ""/);
  assert.match(
    liveApp,
    /function dancerClubDealState\(profile\)[\s\S]*?workingNow &&[\s\S]*?profile\?\.venueId &&[\s\S]*?profile\?\.activeDeal\?\.id &&[\s\S]*?profile\?\.dealAttributionToken/,
  );
  assert.match(liveApp, /function profileDealTileMarkup\(profile\)[\s\S]*?state\.key === "available"/);
  assert.match(liveApp, /data-club-deal-cta/);
  assert.match(liveApp, /postOptionalAuthJson\("\/api\/deals\/redemptions"/);
  assert.match(liveApp, /sourceType: "dancer_profile"/);
});

test("dancer scroll cards reserve the QR slot while only live Club Deals remain actionable", () => {
  const gridDealMarkup =
    liveApp.match(
      /function homeDancerGridQrMarkup\(profile\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryQrMarkup)/,
    )?.[0] || "";
  assert.match(
    gridDealMarkup,
    /const state = dancerClubDealState\(profile\);[\s\S]*?const qr = homeDiscoveryFeedLiveQrData\(profile\);[\s\S]*?if \(!qr \|\| state\.key !== "available"\)/,
  );
  assert.match(gridDealMarkup, /is-unavailable is-\$\{state\.key\}/);
  assert.match(gridDealMarkup, /data-card-qr-label[\s\S]*?data-card-qr-message[\s\S]*?aria-disabled="true"/);
  assert.match(gridDealMarkup, /class="feed-card-action home-card-qr-rail-action is-available"/);
  assert.match(gridDealMarkup, /data-card-action-slot="qr" data-club-deal-state="available" data-feed-live-qr/);
  assert.match(gridDealMarkup, /actionButtonLabel\("qr", "QR"\)/);

  const profileDealMarkup =
    liveApp.match(
      /function profileDealTileMarkup\(profile\) \{[\s\S]*?(?=\n    function profileShareText)/,
    )?.[0] || "";
  assert.match(profileDealMarkup, /data-club-deal-state="\$\{state\.key\}"/);
  assert.match(profileDealMarkup, /clubDealQrSymbolMarkup\("profile-deal-placeholder"\)/);
  assert.match(
    liveApp,
    /function clubDealQrSymbolMarkup\(className = ""\)[\s\S]*?viewBox="0 0 28 28"[\s\S]*?class="qr-finder"[\s\S]*?class="qr-module"/,
  );
  assert.match(liveApp, /\.profile-deal-placeholder \{[\s\S]*?width: 64px;[\s\S]*?min-width: 64px;[\s\S]*?height: 64px;/);
  assert.match(liveApp, /label: "No Club Deal available"/);
  assert.match(liveApp, /label: "Available when working"/);
  assert.match(liveApp, /label: "Not available now"/);
  assert.match(
    liveApp,
    /function profileModalGridMarkup\(profile, options = \{\}\)[\s\S]*?const dealMarkup = options\.preview[\s\S]*?profileDealTileMarkup\(profile[\s\S]*?\$\{dealMarkup\}[\s\S]*?liveProfileModalActionsMarkup\(profile, status\)[\s\S]*?shiftsMarkup\(profile, status/,
  );

  assert.match(
    dancerPage,
    /availability=\{upcomingShifts\.length \? "available-when-working" : "not-available-now"\}/,
  );
  assert.match(venueQrComponent, /type ClubDealAvailability = "no-active-offer" \| "available-when-working" \| "not-available-now"/);
  assert.match(venueQrComponent, /className="venue-qr-placeholder-icon"[\s\S]*?<svg viewBox="0 0 28 28">[\s\S]*?className="qr-finder"[\s\S]*?className="qr-module"/);
  assert.match(dancerPage, /\.venue-qr-placeholder-icon \{ width: 58px; height: 58px;/);
  assert.match(venueQrComponent, /label: "No Club Deal available"/);
  assert.match(venueQrComponent, /label: "Available when working"/);
  assert.match(venueQrComponent, /label: "Not available now"/);
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
