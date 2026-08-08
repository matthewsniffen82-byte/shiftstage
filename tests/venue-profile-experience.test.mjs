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
  assert.match(venueDetail, /Working now at \$\{escapeHtml\(details\.name\)\}/);
  assert.match(venueDetail, /data-venue-jump="venue-upcoming-shifts"[\s\S]*?<span>upcoming shifts<\/span>/);
  assert.match(venueDetail, /id="venue-upcoming-shifts"[\s\S]*?<span>Upcoming at \$\{escapeHtml\(details\.name\)\}<\/span><span class="venue-activity-count" aria-hidden="true">\$\{upcoming\.length\}<\/span>/);
  assert.match(venueDetail, /class="venue-status-grid" aria-label="Venue status"[\s\S]*?venue-operating-summary[\s\S]*?venue-status-kicker">Hours[\s\S]*?\$\{quickStats\}/);
  assert.match(venueDetail, /class="venue-info venue-location-section"[\s\S]*?class="venue-location-actions"[\s\S]*?venue-address-directions[\s\S]*?\$\{rideMarkup\}/);
  assert.equal((venueDetail.match(/\$\{rideMarkup\}/g) || []).length, 1);
  assert.match(venueDetail, /id="venue-no-shift-posted"[\s\S]*?<span>No Shift Posted<\/span>/);
  assert.doesNotMatch(venueDetail, /Trending at|is-trending/);
  assert.doesNotMatch(venueDetail, /verified shifts/i);
  assert.doesNotMatch(
    venueDetail,
    /otherVenues|Other \$\{city\} venues|other venues|venueCard\(item\)/i,
  );
});

test("venue details reuse the production Dancers grid card for every schedule status", () => {
  const venueGrid = liveApp.match(
    /function venueDancerGridMarkup\(profiles, city, label\) \{[\s\S]*?(?=\n    function venueDetailPage)/,
  )?.[0] || "";
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?(?=\n    function findProfile)/,
  )?.[0] || "";
  const sharedCard = liveApp.match(
    /function homeDancerGridCard\(profile, city, compactDirectory = false\) \{[\s\S]*?(?=\n    function homeDancerGridSectionMarkup)/,
  )?.[0] || "";

  assert.match(venueGrid, /class="venue-dancer-grid home-dancer-grid home-dancer-three-column"/);
  assert.match(venueGrid, /profiles\.map\(\(profile\) => homeDancerGridCard\(profile, city, true\)\)/);
  assert.match(venueDetail, /const tonight = localProfiles[\s\S]*?isWorkingTonight\(profile\)/);
  assert.match(venueDetail, /const upcoming = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && profile\.scheduled/);
  assert.match(venueDetail, /const noSchedule = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && !profile\.scheduled/);
  assert.equal((venueDetail.match(/venueDancerGridMarkup\(/g) || []).length, 3);
  assert.doesNotMatch(venueDetail, /profileCard\(|venueUpcomingShiftRow\(|venue-shift-row|venue-shift-list/);
  assert.match(sharedCard, /homeDiscoveryFeedStatus\(profile\)[\s\S]*?homeDancerGridScheduleLabel\(profile, city\)/);
  assert.match(sharedCard, /groupClass = status\.className === "is-now"[\s\S]*?"is-upcoming"[\s\S]*?"is-open"/);
  assert.match(sharedCard, /class="dancer-card home-dancer-grid-card \$\{groupClass\}/);
  assert.match(sharedCard, /href="\$\{profileHref\}"[\s\S]*?aria-label="Open \$\{safeName\}'s full profile"/);
  assert.match(liveApp, /Venue detail uses the exact same compact production profile tiles[\s\S]*?\.venue-dancer-grid \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  assert.match(liveApp, /\.venue-dancer-grid > \.home-dancer-grid-card \{[\s\S]*?aspect-ratio: 9 \/ 16 !important;/);
});

test("venue profiles reserve customer QR language for active Club Deals", () => {
  const venueOffer = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";
  assert.match(
    venueOffer,
    /venue\?\.activeDeal[\s\S]*?<button class="venue-detail-club-deal-qr-state is-available"[\s\S]*?data-club-deal-cta="\$\{encodeDealPass\(config\)\}"[\s\S]*?Click for Club Deal/,
  );
  assert.equal((venueOffer.match(/data-club-deal-cta=/g) || []).length, 1);
  assert.doesNotMatch(venueOffer, /clubDealCtaMarkup|venue-club-deal-cta|Opens after you tap Get Club Deal/);
  assert.match(venueOffer, /venue-club-deal-unavailable[\s\S]*?clubDealQrSymbolMarkup\("venue-detail-club-deal-symbol venue-qr-placeholder-icon"\)[\s\S]*?No active Club Deal[\s\S]*?Check back later/);
  assert.doesNotMatch(venueOffer, /Use Share to send this venue profile|has not published a tracked customer offer/);
  assert.doesNotMatch(venueOffer, /data-venue-profile-qr|Show venue QR|Venue QR/);
});

test("venue profiles use the dancer full-profile QR box in every Club Deal state", () => {
  const venueOffer = liveApp.match(
    /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
  )?.[0] || "";

  assert.match(venueOffer, /<button class="venue-detail-club-deal-qr-state is-available"[\s\S]*?Click for Club Deal[\s\S]*?Unique tracked QR[\s\S]*?<\/button>/);
  assert.match(
    venueOffer,
    /venue-club-deal-unavailable[\s\S]*?venue-qr-unavailable[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?clubDealQrSymbolMarkup\("venue-detail-club-deal-symbol venue-qr-placeholder-icon"\)[\s\S]*?<strong>No active Club Deal<\/strong>/,
  );
  assert.doesNotMatch(venueOffer, /venue-detail-club-deal-unavailable-icon|actionIconMarkup\("lock"\)/);
  assert.match(liveApp, /Venue details use the same compact QR box geometry as dancer full profiles[\s\S]*?\.venue-detail-club-deal-qr-state \{[\s\S]*?width: min\(168px, 100%\) !important;[\s\S]*?min-height: 168px !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?padding: 13px 14px !important;[\s\S]*?border-radius: 14px !important;/);
  assert.match(liveApp, /Venue details use the same compact QR box geometry as dancer full profiles[\s\S]*?\.venue-detail-club-deal-symbol \{[\s\S]*?width: 72px !important;[\s\S]*?height: 72px !important;[\s\S]*?border-radius: 12px !important;/);
  assert.match(liveApp, /\.venue-detail-club-deal-qr-state\.is-unavailable \{[\s\S]*?color: var\(--dancr-color-text-muted\) !important;[\s\S]*?background: var\(--dancr-color-surface\) !important;/);
  assert.match(liveApp, /\.venue-detail-club-deal-qr-state\.is-unavailable \.venue-detail-club-deal-symbol \{[\s\S]*?border-color: rgba\(148, 163, 184, \.14\) !important;[\s\S]*?background: rgba\(148, 163, 184, \.035\) !important;/);
  assert.match(liveApp, /\.venue-detail-club-deal-qr-state\.is-unavailable \.venue-detail-club-deal-qr-copy :is\(\.eyebrow, strong, small\) \{[\s\S]*?color: inherit !important;/);
  assert.match(liveApp, /#profileBackdrop \.profile-qr-unavailable \{[\s\S]*?width: min\(168px, 100%\) !important;[\s\S]*?min-height: 168px !important;/);
});

test("venue profile hierarchy stays compact and carries the restrained venue brand signature", () => {
  const refinement = aesthetic.match(/Production venue-detail refinement keeps one neutral frame[\s\S]*$/)?.[0] || "";

  assert.ok(refinement, "the final production venue-detail refinement must exist");
  assert.match(refinement, /\.venue-main-photo \{[\s\S]*?position: relative !important;[\s\S]*?min-height: clamp\(156px, 35vw, 186px\) !important;/);
  assert.match(refinement, /\.venue-detail-logo-shell \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?isolation: isolate;/);
  assert.match(refinement, /\.venue-detail-logo-shell \{[\s\S]*?width: calc\(100% - clamp\(28px, 8vw, 48px\)\) !important;[\s\S]*?height: calc\(100% - clamp\(24px, 6vw, 38px\)\) !important;[\s\S]*?max-width: 480px !important;[\s\S]*?max-height: 158px !important;[\s\S]*?overflow: visible !important;/);
  assert.match(refinement, /Compact venue heroes reserve a clear lane for the fixed close control[\s\S]*?@media \(max-width: 650px\) \{[\s\S]*?\.venue-detail-logo-shell \{[\s\S]*?left: calc\(50% - clamp\(24px, 6vw, 36px\)\) !important;[\s\S]*?width: calc\(100% - clamp\(86px, 22vw, 108px\)\) !important;/);
  assert.match(refinement, /\.venue-detail-logo \{[\s\S]*?position: absolute !important;[\s\S]*?inset: 0 !important;[\s\S]*?width: 100% !important;[\s\S]*?height: 100% !important;[\s\S]*?max-width: 100% !important;[\s\S]*?max-height: 100% !important;[\s\S]*?object-fit: contain !important;[\s\S]*?object-position: center center !important;/);
  assert.match(refinement, /\.venue-detail-logo-shell::before \{[\s\S]*?var\(--dancr-color-brand-primary-soft\)[\s\S]*?var\(--dancr-color-brand-glow-soft\)[\s\S]*?filter: blur\(18px\);/);
  assert.match(refinement, /\.venue-hero-body \{[\s\S]*?display: grid !important;[\s\S]*?gap: 8px !important;[\s\S]*?padding: 12px 14px 14px !important;/);
  assert.match(refinement, /#venueDetailName \{[\s\S]*?color: var\(--dancr-color-brand-core\) !important;/);
  assert.match(refinement, /\.venue-identity-copy \{[\s\S]*?padding-left: 0;/);
  assert.doesNotMatch(refinement, /\.venue-identity-copy::before/);
  assert.match(refinement, /\.venue-address-copy \.meta \{[\s\S]*?overflow: visible !important;[\s\S]*?-webkit-line-clamp: unset !important;/);
  assert.match(refinement, /\.venue-status-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?gap: 8px;/);
  assert.match(refinement, /:is\(\.venue-operating-summary, \.venue-quick-stat\) \{[\s\S]*?min-height: 60px !important;[\s\S]*?background: var\(--dancr-color-surface-subtle\) !important;/);
  assert.match(refinement, /\.venue-address-tile \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(refinement, /\.venue-location-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(refinement, /\.venue-address-directions \{[\s\S]*?width: 100% !important;[\s\S]*?min-height: 48px !important;[\s\S]*?display: inline-flex !important;/);
  assert.match(refinement, /\.venue-detail-uber \{[\s\S]*?width: 100% !important;[\s\S]*?min-height: 48px !important;[\s\S]*?margin: 0 !important;/);
  assert.match(refinement, /button\.venue-detail-club-deal-qr-state\.is-available:focus-visible \{[\s\S]*?var\(--dancr-color-success\)[\s\S]*?transparent/);
  assert.match(refinement, /button\.venue-detail-club-deal-qr-state\.is-available:is\(\.is-loading, :disabled\) \{[\s\S]*?cursor: wait;/);
  assert.match(refinement, /\.venue-detail-club-deal-qr-state \{[\s\S]*?width: min\(168px, 100%\) !important;[\s\S]*?min-height: 168px !important;[\s\S]*?border-radius: 14px !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(refinement, /\.venue-club-deal-unavailable\.venue-offer-card \{[\s\S]*?width: min\(168px, 100%\) !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(refinement, /\.action-btn\.follow-venue-btn:not\(\.is-following\) \{[\s\S]*?width: 100% !important;[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?background: var\(--dancr-color-surface-raised\) !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(
    refinement,
    /\.action-btn\.follow-venue-btn\.is-following \{[\s\S]*?var\(--dancr-color-brand-primary\) 28%,[\s\S]*?var\(--dancr-color-border-subtle\)[\s\S]*?color: var\(--dancr-color-text-primary\) !important;[\s\S]*?var\(--dancr-color-brand-primary\) 6%,[\s\S]*?var\(--dancr-color-surface-raised\) 94%[\s\S]*?var\(--dancr-color-brand-primary\) 8%,[\s\S]*?transparent/,
  );
  assert.match(refinement, /\.venue-quick-stat\.is-working strong \{[\s\S]*?var\(--dancr-color-success\)/);
  assert.match(refinement, /\.venue-quick-stat\.is-upcoming strong \{[\s\S]*?var\(--dancr-color-info\)/);
  assert.match(refinement, /\.venue-activity-empty \{[\s\S]*?grid-template-columns: 38px minmax\(0, 1fr\);[\s\S]*?padding: 12px 13px;/);
  assert.match(refinement, /\.venue-activity-count \{[\s\S]*?min-width: 28px;[\s\S]*?color: var\(--dancr-color-info\);/);
  assert.match(refinement, /\.venue-activity-section\.is-working \.venue-activity-count \{[\s\S]*?color: var\(--dancr-color-success\);/);
  assert.match(refinement, /\.venue-activity-section\.is-upcoming \.venue-activity-count \{[\s\S]*?color: var\(--dancr-color-info\);/);
  assert.match(refinement, /\.venue-activity-section\.is-open \.section-title \{[\s\S]*?border-left-color: var\(--dancr-color-text-muted\) !important;/);
  assert.doesNotMatch(refinement, /home-bottom|home-nav-|global-mobile-bottom-nav|discoveryTabs/);
});

test("venue profiles replace repeated zero sections with one truthful empty explanation", () => {
  const venueDetail = liveApp.match(/function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(venueDetail, /const quickStats = \[[\s\S]*?tonight\.length[\s\S]*?upcoming\.length[\s\S]*?filter\(Boolean\)\.join\(""\)/);
  assert.match(venueDetail, /venue-quick-stat is-working[\s\S]*?venue-quick-stat is-upcoming/);
  assert.match(venueDetail, /const activitySections = \[[\s\S]*?venue-activity-section is-working[\s\S]*?venue-activity-section is-upcoming[\s\S]*?venue-activity-section is-open/);
  assert.match(venueDetail, /const activityMarkup = activitySections \|\|[\s\S]*?No affiliated dancers yet[\s\S]*?No approved dancer profiles are currently affiliated with \$\{escapeHtml\(details\.name\)\}\. Follow this venue for updates\./);
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
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\);/,
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
    /function focusVenueProfileStart\(\{ showFocusRing = false \} = \{\}\) \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileScroll\(\);[\s\S]*?toggleAttribute\("data-auto-focus", !showFocusRing\);[\s\S]*?focus\(\{ preventScroll: true \}\);/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close\[data-auto-focus\]:is\(:focus, :focus-visible\) \{[\s\S]*?outline: 0 !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close:focus-visible:not\(\[data-auto-focus\]\) \{[\s\S]*?border-color: var\(--dancr-color-info\) !important;[\s\S]*?outline: 2px solid var\(--dancr-color-info\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.venue-detail-close \{[\s\S]*?top: max\([\s\S]*?18px,[\s\S]*?var\(--dancr-viewport-top\)[\s\S]*?\+ 12px\)[\s\S]*?right: max\(12px, calc\(\(100vw - 720px\) \/ 2 \+ 12px\)\) !important;/,
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
    /const venueProfileLink = event\.target\.closest\("\[data-open-venue-profile\]"\);[\s\S]*?openVenueFromName\(venueProfileLink\.dataset\.openVenueProfile, \{ showFocusRing: event\.detail === 0 \}\);/,
  );
  assert.match(profileRoute, /permanentRedirect/);
});
