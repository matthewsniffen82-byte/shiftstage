import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileRoute = await readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

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
  assert.match(venueDetail, /data-venue-follow="\$\{venue\.name\}"/);
  assert.match(venueDetail, /https:\/\/maps\.google\.com\/\?q=/);
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

test("venue QR access remains visible before a paid Club Deal is activated", () => {
  assert.match(
    liveApp,
    /function venueOfferMarkup\(venue\)[\s\S]*?venue\?\.activeDeal[\s\S]*?clubDealCtaMarkup\(config, "venue-club-deal-cta"\)[\s\S]*?venue-profile-qr-card[\s\S]*?data-venue-profile-qr="\$\{venueValue\}"/,
  );
  assert.match(
    liveApp,
    /function openVenueQrOverlay\(venueName, city, triggerButton\)[\s\S]*?venueShareUrl\(venue, city\)[\s\S]*?kicker: "Venue QR"[\s\S]*?openLabel: "Open venue"/,
  );
  assert.match(
    liveApp,
    /function handleQrClick\(event\)[\s\S]*?event\.target\.closest\("\[data-venue-profile-qr\]"\)[\s\S]*?openVenueQrOverlay/,
  );
  assert.match(
    liveApp,
    /recordVenuePageEvent\(\{[\s\S]*?venueId: venue\.id,[\s\S]*?eventType: "qr_impression",[\s\S]*?source: "venue_page"/,
  );
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
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    liveApp,
    /function activateHomeDestination\(nextTab\) \{[\s\S]*?if \(profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);[\s\S]*?if \(nextTab === "venues" && activeTab === "venues" && selectedVenueName\) \{[\s\S]*?selectedVenueName = null;/,
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
