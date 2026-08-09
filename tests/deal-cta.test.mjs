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
  venueDealQrRoute,
  claimPage,
  claimClient,
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
  readFile(new URL("../app/api/venue/deal/qr/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/claim/[dealId]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/claim/[dealId]/DealClaimClient.tsx", import.meta.url), "utf8"),
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

test("issued deal passes preserve their original customer-facing terms after a live offer is edited", () => {
  assert.match(redemptionRoute, /dealTitle: deal\.dealTitle/);
  assert.match(redemptionRoute, /dealDescription: deal\.dealDescription/);
  assert.match(redemptionRoute, /dealTerms: deal\.dealTerms/);
  assert.match(deals, /deal_snapshot: issuedDealSnapshot\(input\)/);
  assert.match(deals, /function readIssuedDealSnapshot\(audit: unknown\)/);
  assert.match(deals, /if \(existingDeal\) await snapshotIssuedDealPassesBeforeUpdate\(db, existingDeal\)/);
  assert.match(deals, /\.from\("qr_redemptions"\)[\s\S]*?\.select\("id, audit"\)[\s\S]*?\.eq\("status", "generated"\)[\s\S]*?\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(deals, /update\(\{ audit: \{ \.\.\.\(row\.audit \|\| \{\}\), deal_snapshot: snapshot \} \}\)/);
  assert.match(deals, /const dealSnapshot = readIssuedDealSnapshot\(row\.audit\)/);
  assert.match(deals, /dealTitle: dealSnapshot \? dealSnapshot\.dealTitle : deal\.deal_title/);
  assert.match(deals, /dealTerms: dealSnapshot \? dealSnapshot\.dealTerms : deal\.deal_terms/);
});

test("venue pages and directory cards promote real active deals", () => {
  assert.match(venuePage, /permanentRedirect/);
  assert.doesNotMatch(venuePage, /ClubDealCard|stickyCta/);
  assert.match(liveApp, /function venueOfferMarkup\(venue\)[\s\S]*?venue\?\.activeDeal[\s\S]*?id="club-deal"/);
  assert.match(
    venueDirectory,
    /permanentRedirect\(homeDiscoveryHref\("venues", params\.city\)\)/,
  );
  assert.doesNotMatch(venueDirectory, /getActiveClubDealsForVenues|venue-card-deal/);
  assert.match(
    liveApp,
    /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?data-club-deal-cta/,
  );
  const venueQrHelper =
    liveApp.match(
      /function homeVenueDiscoveryQrMarkup\(venue\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
    )?.[0] || "";
  assert.match(
    venueQrHelper,
    /venue\?\.id && venue\.activeDeal\?\.id[\s\S]*?const offerCount = venue\.activeDeals\?\.length \|\| 1[\s\S]*?home-card-qr-rail-action home-venue-discovery-rail-qr is-available[\s\S]*?data-card-action-slot="qr"[\s\S]*?data-club-deal-cta[\s\S]*?actionButtonLabel\("qr", offerCount > 1 \? `\$\{offerCount\} Deals` : "Get Deal"\)/,
  );
  assert.match(
    venueQrHelper,
    /home-venue-discovery-rail-qr is-unavailable[\s\S]*?data-card-qr-label="Club Deal unavailable"[\s\S]*?data-card-qr-message="This venue has not published a tracked Club Deal\. Check back later\."/,
  );
  assert.doesNotMatch(venueQrHelper, /home-venue-discovery-club-deal|aria-disabled="true"/);
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
    /<button class="venue-detail-club-deal-qr-state is-available"[\s\S]*?data-club-deal-state="available"[\s\S]*?data-club-deal-cta="\$\{encodeDealPass\(config\)\}"[\s\S]*?clubDealQrSymbolMarkup\("venue-detail-club-deal-symbol"\)[\s\S]*?View Club Deals[\s\S]*?live offers[\s\S]*?<\/button>/,
  );
  assert.equal((venueOffer.match(/data-club-deal-cta=/g) || []).length, 1);
  assert.doesNotMatch(venueOffer, /clubDealCtaMarkup|venue-club-deal-cta|Opens after you tap Get Club Deal/);
  assert.match(
    venueOffer,
    /data-club-deal-state="unavailable"[\s\S]*?clubDealQrSymbolMarkup\("venue-detail-club-deal-symbol venue-qr-placeholder-icon"\)[\s\S]*?No active Club Deal[\s\S]*?Check back later/,
  );
  assert.match(liveApp, /\.venue-detail-club-deal-actions \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?justify-items: center;/);
  assert.match(liveApp, /@media \(max-width: 520px\) \{[\s\S]*?\.venue-detail-club-deal-actions \{[\s\S]*?grid-template-columns: 1fr;/);
  assert.doesNotMatch(venueOffer, /data-venue-profile-qr|Show venue QR/);
  const venueSlide =
    liveApp.match(
      /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
    )?.[0] || "";
  assert.match(venueSlide, /const railQrMarkup = homeVenueDiscoveryQrMarkup\(venue\)/);
  assert.doesNotMatch(venueSlide, /const qrMarkup|dealMarkup|home-venue-discovery-deal/);
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

test("venues can generate a durable tracked QR for each published deal", () => {
  assert.match(venueDealQrRoute, /getAccountByUserId\(client, user\.id\)/);
  assert.match(venueDealQrRoute, /account\.role !== "venue" \|\| account\.accountState !== "active"/);
  assert.match(venueDealQrRoute, /getVenueDealsForAccount\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.match(venueDealQrRoute, /owned\?\.deals\.find\(\(candidate\) => candidate\.id === dealId\)/);
  assert.match(venueDealQrRoute, /!deal\.isActive \|\| deal\.payoutType !== "flat" \|\| deal\.payoutAmountCents <= 0/);
  assert.match(venueDealQrRoute, /createVenueDealCampaignToken\(\{ dealId: deal\.id, venueId: deal\.venueId \}\)/);
  assert.match(venueDealQrRoute, /\/deals\/claim\/\$\{encodeURIComponent\(deal\.id\)\}\?campaign=\$\{encodeURIComponent\(campaignToken\)\}/);
  assert.match(venueDealQrRoute, /QRCode\.toDataURL\(claimUrl/);
  assert.match(customerDashboard, /<h3 id="venue-deal-qr-heading">Tracked Deal QR<\/h3>/);
  assert.match(customerDashboard, /fetch\(`\/api\/venue\/deal\/qr\?dealId=/);
  assert.match(customerDashboard, />Print sign<\/button>/);
  assert.match(customerDashboard, />Download<\/button>/);
  assert.match(customerDashboard, />Copy link<\/button>/);
  assert.match(customerDashboard, /Published deals appear on your venue page and on affiliated dancer profiles while those dancers are verified Working Now/);
  assert.match(customerDashboard, /Direct venue attribution · MyDancr tracked/);
});

test("posted venue QR scans issue unique direct-attribution customer passes", () => {
  assert.match(claimPage, /getActiveClubDealById\(createAdminSupabaseClient\(\), dealId\)/);
  assert.match(claimPage, /verifyVenueDealCampaignToken\(campaignToken\)/);
  assert.match(claimPage, /campaign\.dealId !== dealId/);
  assert.match(claimPage, /deal\.venueId !== campaign\.venueId/);
  assert.match(claimPage, /<DealClaimClient campaignToken=\{campaignToken\} deal=\{deal\}/);
  assert.match(claimClient, /fetch\("\/api\/deals\/redemptions"/);
  assert.match(claimClient, /clubDealId: deal\.id/);
  assert.match(claimClient, /venueId: deal\.venueId/);
  assert.match(claimClient, /sourceType: "club_page"/);
  assert.match(claimClient, /campaignToken/);
  assert.match(claimClient, /sessionId: readOrCreateDealSessionId\(\)/);
  assert.match(claimClient, /window\.location\.replace\(`\/deals\/pass\/\$\{encodeURIComponent\(data\.redemption\.redemptionToken\)\}`\)/);
  assert.doesNotMatch(claimClient, /dancerId|attributionToken/);
  assert.match(redemptionRoute, /verifyVenueDealCampaignToken\(campaignToken\)/);
  assert.match(redemptionRoute, /campaign\.dealId !== clubDealId \|\| campaign\.venueId !== venueId/);
  assert.match(redemptionRoute, /campaignSource = "venue_qr"/);
  assert.match(deals, /campaign_source: input\.campaignSource \|\| null/);
  assert.match(deals, /postedVenueQrScansThisMonth/);
  assert.match(customerDashboard, /label="Posted QR scans"/);
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

test("club deal picker uses neutral accessible cards with generation feedback", () => {
  assert.match(
    liveApp,
    /\.dancr-button-system \.club-deal-hub-offer \{[\s\S]*?border: 1px solid rgba\(255, 255, 255, \.13\) !important;[\s\S]*?linear-gradient\(145deg, rgba\(31, 32, 38, \.94\), rgba\(20, 21, 26, \.96\)\) !important/,
  );
  assert.match(liveApp, /\.dancr-button-system \.club-deal-hub-offer span \{[\s\S]*?color: #35D8FF;/);
  assert.match(liveApp, /\.dancr-button-system \.club-deal-hub-offer small \{[\s\S]*?rgba\(248, 248, 252, \.78\)/);
  assert.match(liveApp, /id="clubDealHubStatus" role="status" aria-live="polite" hidden/);
  assert.match(liveApp, /data-club-deal-offer="\$\{encodeDealPass\(selection\)\}" aria-pressed="false"/);
  assert.match(
    liveApp,
    /offerButton\.classList\.add\("is-loading"\)[\s\S]*?status\.textContent = "Creating your tracked QR…"[\s\S]*?await createRevenueDealPass\(selection\)/,
  );
  assert.match(liveApp, /status\.textContent = error\.message \|\| "Unable to create the Club Deal QR\. Please try again\."/);
  assert.match(liveApp, /class="deal-pass-sheet club-deal-hub-sheet"[\s\S]*?tabindex="-1"/);
  assert.match(liveApp, /overlay\.querySelector\("\.club-deal-hub-sheet"\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test("checked-in dancer profiles and MyDancr TV promote attributed deals without exposing future shifts", () => {
  assert.match(dancerPage, /\{activeShift \? \([\s\S]*?\{activeDeal \? \([\s\S]*?sourceType="dancer_profile"/);
  assert.match(dancerPage, /function isActiveNow[\s\S]*?Boolean\(shift\.checkedInAt\)[\s\S]*?!shift\.checkedOutAt/);
  assert.doesNotMatch(dancerPage, /autoGenerate/);
  assert.match(tvSource, /video\.shift\?\.isActive && video\.venue/);
  assert.match(tvSource, /const venueDeals = video\.shift\?\.isActive && video\.venue[\s\S]*?const deal = venueDeals\[0\] \|\| null/);
  assert.match(tvSource, /createDancerDealAttributionToken/);
  assert.match(tvClient, /video\.shift\?\.isActive && video\.venue && video\.deal/);
  assert.match(tvClient, /sourceType="dancer_profile"/);
  assert.match(tvClient, /attributionToken=\{video\.dealAttributionToken\}/);
  assert.match(tvClient, /attributionTokens=\{video\.dealAttributionTokens\}/);
  assert.match(tvClient, /presentation="launcher"/);
  assert.match(
    liveApp,
    /const hasLiveDeal = item\?\.shift\?\.isActive === true[\s\S]*?item\?\.venue\?\.id && item\?\.deal\?\.id && item\?\.dealAttributionToken[\s\S]*?deal\.dataset\.clubDealCta = encodeDealPass[\s\S]*?attributionToken: item\.dealAttributionToken/,
  );
  assert.match(liveApp, /deal\.dataset\.feedLiveQr = "true"/);
});

test("homepage live profiles use the server-generated revenue QR only while Working Now", () => {
  assert.match(discoveryRoute, /activeDeals: activeDeals\.get\(venue\.id\) \|\| \[\][\s\S]*?activeDeal: activeDeals\.get\(venue\.id\)\?\.\[0\] \|\| null/);
  assert.match(discoveryRoute, /const dancerDeals = dancer\.venueId \? activeDeals\.get\(dancer\.venueId\) \|\| \[\] : \[\][\s\S]*?const activeDeal = dancerDeals\[0\] \|\| null/);
  assert.match(discoveryRoute, /const dealAttributionTokens[\s\S]*?createDancerDealAttributionToken/);
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
  assert.match(gridDealMarkup, /actionButtonLabel\("qr", qr\.offerCount > 1 \? `\$\{qr\.offerCount\} Deals` : "Deal"\)/);

  const profileDealMarkup =
    liveApp.match(
      /function profileDealTileMarkup\(profile\) \{[\s\S]*?(?=\n    function profileShareText)/,
    )?.[0] || "";
  assert.match(profileDealMarkup, /data-club-deal-state="\$\{state\.key\}"/);
  assert.match(profileDealMarkup, /clubDealQrSymbolMarkup\("profile-deal-placeholder"\)/);
  assert.match(profileDealMarkup, /"Available when dancer is working"/);
  assert.doesNotMatch(profileDealMarkup, /How Club Deals work|stateDetail/);
  const unavailableProfileDealMarkup = profileDealMarkup.match(
    /const unavailableLabel[\s\S]*$/,
  )?.[0] || "";
  assert.doesNotMatch(unavailableProfileDealMarkup, /profile-deal-disclosure|profile-deal-note/);
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
    /function profileModalGridMarkup\(profile, options = \{\}\)[\s\S]*?const dealMarkup = options\.preview[\s\S]*?profileDealTileMarkup\(profile[\s\S]*?\$\{shiftsMarkup\(profile, status[\s\S]*?\$\{dealMarkup\}[\s\S]*?liveProfileModalActionsMarkup\(profile, status\)/,
  );

  assert.match(
    dancerPage,
    /availability=\{upcomingShifts\.length \? "available-when-working" : "not-available-now"\}/,
  );
  assert.match(venueQrComponent, /type ClubDealAvailability = "no-active-offer" \| "available-when-working" \| "not-available-now"/);
  assert.match(venueQrComponent, /className="venue-qr-placeholder-icon"[\s\S]*?<svg viewBox="0 0 28 28">[\s\S]*?className="qr-finder"[\s\S]*?className="qr-module"/);
  assert.match(
    dancerPage,
    /\.venue-qr-unavailable \{[\s\S]*?width: min\(168px, 100%\);[\s\S]*?min-height: 168px;[\s\S]*?aspect-ratio: 1 \/ 1;[\s\S]*?justify-self: center;/,
  );
  assert.match(
    dancerPage,
    /\.venue-qr-placeholder-icon \{ width: 72px; height: 72px;[\s\S]*?border: 1px solid rgba\(148,163,184,\.14\);[\s\S]*?color: rgba\(148,163,184,\.58\);[\s\S]*?box-shadow: none; opacity: \.62;/,
  );
  assert.match(venueQrComponent, /const label = availability === "no-active-offer"[\s\S]*?"No Club Deal available"[\s\S]*?: "Available when dancer is working"/);
  assert.match(venueQrComponent, /className=\{`venue-qr-unavailable is-\$\{availability\}`\}[\s\S]*?className="venue-qr-placeholder-icon"/);
  assert.match(venueQrComponent, /className="venue-qr-unavailable-label">Club Deal<\/span>/);
  assert.doesNotMatch(venueQrComponent, /venue-qr-explanation|How Club Deals work|status\.detail/);
  assert.doesNotMatch(dancerPage, /\.venue-qr-explanation/);
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
