import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileRoute = await readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("legacy venue URLs resolve real production data before redirecting to the canonical in-app profile", () => {
  assert.match(profileRoute, /getVenueProfile\(createAdminSupabaseClient\(\), slug\)/);
  assert.match(profileRoute, /if \(!venue\) notFound\(\)/);
  assert.match(
    profileRoute,
    /permanentRedirect\([\s\S]*?city=\$\{encodeURIComponent\(venue\.city \|\| "Las Vegas"\)\}&venue=\$\{encodeURIComponent\(venue\.slug\)\}/,
  );
  assert.doesNotMatch(
    profileRoute,
    /PublicProfileHeader|FloatingProfileHomeLink|VenueProfileActions|ClubDealCard|TvVideoStrip/,
  );
});

test("the canonical in-app venue page is dedicated to the selected club and its live production data", () => {
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueDetail, /venueDancers\(city, venue\.name\)/);
  assert.match(
    venueDetail,
    /const tonight = localProfiles[\s\S]*?isWorkingTonight\(profile\)[\s\S]*?const upcoming = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && profile\.scheduled/,
  );
  assert.match(venueDetail, /recordVenuePageEvent\(\{ venueId: venue\.id, eventType: "page_view", source: "venue_page" \}\)/);
  assert.match(venueDetail, /venueOfferMarkup\(venue\)/);
  assert.doesNotMatch(venueDetail, /\/api\/public\/maps\/embed\?address=|<iframe/i);
  assert.match(venueDetail, /class="action-btn secondary follow-venue-btn[\s\S]*?data-venue-follow="\$\{venue\.name\}"/);
  assert.match(venueDetail, /https:\/\/maps\.google\.com\/\?q=/);
  assert.match(venueDetail, /class="venue-identity-meta"[\s\S]*?venue-identity-distance[\s\S]*?details\.distanceLabel[\s\S]*?class="info-tile venue-address-tile"[\s\S]*?class="venue-address-copy"[\s\S]*?class="venue-address-directions"/);
  assert.equal((venueDetail.match(/encodeURIComponent\(details\.address\)/g) || []).length, 1);
  assert.doesNotMatch(venueDetail, /<div class="info-tile"><strong>Distance<\/strong>/);
  assert.doesNotMatch(venueDetail, /details\.description|venue-confirmed shifts|nightlife venue in/);
  assert.doesNotMatch(venueDetail, /<div class="info-tile"><strong>Hours/);
  assert.match(venueDetail, /Working now at \$\{details\.name\}/);
  assert.match(venueDetail, /data-venue-jump="venue-upcoming-shifts"[\s\S]*?<span>upcoming shifts<\/span>/);
  assert.match(venueDetail, /id="venue-upcoming-shifts">Upcoming shifts at \$\{details\.name\}/);
  assert.match(venueDetail, /Trending at \$\{details\.name\}/);
  assert.doesNotMatch(venueDetail, /verified shifts/i);
  assert.doesNotMatch(
    venueDetail,
    /otherVenues|Other \$\{city\} venues|other venues|venueCard\(item\)/i,
  );
});

test("venue profiles reserve customer QR language for active Club Deals", () => {
  const venueOffer = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";
  assert.match(
    venueOffer,
    /venue\?\.activeDeal[\s\S]*?clubDealCtaMarkup\(config, "venue-club-deal-cta"\)/,
  );
  assert.match(venueOffer, /venue-club-deal-unavailable[\s\S]*?actionIconMarkup\("lock"\)[\s\S]*?No active Club Deal[\s\S]*?Check back later/);
  assert.doesNotMatch(venueOffer, /Use Share to send this venue profile|has not published a tracked customer offer/);
  assert.doesNotMatch(venueOffer, /data-venue-profile-qr|Show venue QR|Venue QR/);
});

test("venue profiles keep every Club Deal QR state prominent without an oversized empty state", () => {
  const venueOffer = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";

  assert.match(venueOffer, /data-club-deal-state="available"[\s\S]*?Unique tracked QR[\s\S]*?Get Club Deal/);
  assert.match(
    venueOffer,
    /venue-club-deal-unavailable[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?venue-detail-club-deal-unavailable-icon[\s\S]*?actionIconMarkup\("lock"\)[\s\S]*?<strong>No active Club Deal<\/strong>/,
  );
  assert.doesNotMatch(venueOffer.match(/<article class="venue-offer-card venue-club-deal-unavailable"[\s\S]*?<\/article>/)?.[0] || "", /clubDealQrSymbolMarkup|Club Deal QR/);
  assert.match(liveApp, /\.venue-detail \.venue-club-deal-unavailable \{[\s\S]*?padding: 9px 10px;/);
  assert.match(liveApp, /\.venue-club-deal-unavailable \.venue-detail-club-deal-qr-state \{[\s\S]*?grid-template-columns: 58px minmax\(0, 1fr\);[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
});

test("venue profile hierarchy stays compact and keeps Club Deals stronger than following", () => {
  const refinement = aesthetic.match(/Production venue-detail refinement keeps one neutral frame[\s\S]*$/)?.[0] || "";

  assert.ok(refinement, "the final production venue-detail refinement must exist");
  assert.match(refinement, /\.venue-main-photo \{[\s\S]*?min-height: clamp\(200px, 46vw, 248px\) !important;/);
  assert.match(refinement, /\.venue-detail-logo-shell \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(refinement, /\.venue-hero-body \{[\s\S]*?gap: 10px !important;[\s\S]*?padding: 12px 14px 14px !important;/);
  assert.match(refinement, /\.venue-address-copy \.meta \{[\s\S]*?overflow: visible !important;[\s\S]*?-webkit-line-clamp: unset !important;/);
  assert.match(refinement, /\.club-deal-primary-cta\.venue-club-deal-cta \{[\s\S]*?var\(--dancr-color-brand-primary\)[\s\S]*?var\(--dancr-shadow-brand-control\)/);
  assert.match(refinement, /\.action-btn\.follow-venue-btn:not\(\.is-following\) \{[\s\S]*?background: var\(--dancr-color-surface-raised\) !important;[\s\S]*?box-shadow: none !important;/);
  assert.doesNotMatch(refinement, /home-bottom|home-nav-|global-mobile-bottom-nav|discoveryTabs/);
});

test("venue profiles replace repeated zero sections with one truthful empty explanation", () => {
  const venueDetail = liveApp.match(/function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(venueDetail, /const quickStats = \[[\s\S]*?tonight\.length[\s\S]*?upcoming\.length[\s\S]*?filter\(Boolean\)\.join\(""\)/);
  assert.match(venueDetail, /const activitySections = \[[\s\S]*?venue-activity-section is-working[\s\S]*?venue-activity-section is-upcoming[\s\S]*?venue-activity-section is-trending/);
  assert.match(venueDetail, /const activityMarkup = activitySections \|\|[\s\S]*?No dancers active or scheduled[\s\S]*?No dancers are checked in and no upcoming shifts have been posted\. Follow \$\{details\.name\} for updates\./);
  assert.doesNotMatch(venueDetail, /No active shifts now|No upcoming shifts posted|No trending profiles here yet/);
});

test("venue profiles stay full-screen with X dismissal and the shared floating navigation", () => {
  assert.match(
    liveApp,
    /<div class="venue-detail" role="dialog" aria-modal="true" aria-labelledby="venueDetailName">/,
  );
  assert.match(
    liveApp,
    /class="close-btn venue-detail-close"[\s\S]*?data-close-venue-profile[\s\S]*?aria-label="Close \$\{details\.name\} venue profile"/,
  );
  assert.match(
    liveApp,
    /#results\.venue-profile-overlay \{[\s\S]*?position: fixed !important;[\s\S]*?z-index: 140;[\s\S]*?height: 100dvh !important;[\s\S]*?overflow-y: auto !important;[\s\S]*?overflow-anchor: none !important;/,
  );
  assert.match(
    liveApp,
    /body\.profile-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs,\s*body\.venue-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs \{[\s\S]*?z-index: 210;[\s\S]*?visibility: visible !important;[\s\S]*?pointer-events: auto !important;/,
  );
  assert.match(
    liveApp,
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(132px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(132px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    liveApp,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?if \(profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);[\s\S]*?if \(nextTab === "venues" && activeTab === "venues" && selectedVenueName\) \{[\s\S]*?selectedVenueName = null;/,
  );
  assert.match(
    liveApp,
    /function closeVenueProfile\(\) \{[\s\S]*?selectedVenueName = null;[\s\S]*?item\.setAttribute\("aria-current", isActive \? "page" : "false"\);[\s\S]*?syncHomeDestinationLocation\("venues"\);[\s\S]*?render\(\);/,
  );
  assert.match(
    liveApp,
    /const venueProfileClose = event\.target\.closest\("\[data-close-venue-profile\]"\);[\s\S]*?closeVenueProfile\(\);/,
  );
  assert.match(
    liveApp,
    /function focusVenueProfileStart\(\) \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?focus\(\{ preventScroll: true \}\);/,
  );
});

test("venue entry points use the canonical in-app venue profile", () => {
  assert.match(
    liveApp,
    /function venueExperienceHref\(venue, city = selectedCity\(\)\)[\s\S]*?new URLSearchParams\(\{[\s\S]*?city: venueCity,[\s\S]*?venue: venueSlug[\s\S]*?return `\/\?\$\{query\.toString\(\)\}`/,
  );
  assert.match(
    liveApp,
    /function venueCard\(venue\)[\s\S]*?const city = citySelect\.value[\s\S]*?const venueHref = venueExperienceHref\(venue, city\)/,
  );
  assert.match(
    liveApp,
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\)[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?aria-label="Open \$\{safeName\}'s full venue profile"/,
  );
  assert.match(
    liveApp,
    /const venueProfileLink = event\.target\.closest\("\[data-open-venue-profile\]"\);[\s\S]*?openVenueFromName\(venueProfileLink\.dataset\.openVenueProfile\);/,
  );
  assert.match(profileRoute, /permanentRedirect/);
});
