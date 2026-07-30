import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("mobile discovery uses a persistent five-destination app navigation", () => {
  const navigation = homeSource.match(
    /<nav class="tabs" id="discoveryTabs"[\s\S]*?<\/nav>/,
  )?.[0] || "";
  assert.match(
    navigation,
    /data-tab="tonight"[\s\S]*data-tab="dancers"[\s\S]*id="homeBottomTv"[\s\S]*data-tab="venues"[\s\S]*data-tab="trending"/,
  );
  assert.doesNotMatch(navigation, /class="tab active"/);
  assert.match(navigation, /id="homeBottomTv"[^>]*aria-controls="results"[^>]*aria-current="false"/);
  assert.doesNotMatch(navigation, /id="homeBottomTv"[^>]*href=/);
  assert.match(homeSource, /#discoveryTabs \{[\s\S]*position: fixed !important[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
  assert.match(homeSource, /@media \(max-width: 720px\)[\s\S]*?\.home-tv-launch \{\s*display: none !important/);
  assert.match(
    homeSource,
    /bottomTv\.setAttribute\("aria-label", `Show MyDancr TV \$\{tvCityLabel\} videos in the Home feed`\)/,
  );
});

test("the Home TV button renders a real snap-scroll video feed without leaving Home", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?overflow-y: auto[\s\S]*?scroll-snap-type: y mandatory[\s\S]*?\.home-tv-feed-slide \{[\s\S]*?height: 100%[\s\S]*?scroll-snap-align: start[\s\S]*?scroll-snap-stop: always/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?overscroll-behavior-y: none[\s\S]*?touch-action: pan-y/,
  );
  assert.match(
    homeSource,
    /html\.home-tv-feed-locked,[\s\S]*?body\.home-tv-feed-locked \{[\s\S]*?overflow: hidden !important[\s\S]*?body\.home-tv-feed-locked \{[\s\S]*?position: fixed !important[\s\S]*?height: 100dvh !important/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?position: fixed !important[\s\S]*?inset: 0 !important[\s\S]*?width: 100vw !important[\s\S]*?height: var\(--home-tv-feed-height, 100dvh\) !important[\s\S]*?border-radius: 0/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab\) \{[\s\S]*?activeTab = nextTab;[\s\S]*?const isTv = nextTab === "tv";[\s\S]*?render\(\);[\s\S]*?focusAndLockHomeTvFeed/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedViewport\(\)[\s\S]*?window\.visualViewport\?\.height \|\| window\.innerHeight[\s\S]*?--home-tv-feed-height/,
  );
  assert.match(
    homeSource,
    /function focusAndLockHomeTvFeed\(\) \{\s*lockHomeTvFeedViewport\(\);\s*\}/,
  );
  assert.match(
    homeSource,
    /function deactivateHomeTvFeed\(\) \{[\s\S]*?unlockHomeTvFeedViewport\(\)/,
  );
  assert.match(
    homeSource,
    /fetch\(`\/api\/public\/tv\?city=\$\{encodeURIComponent\(city\)\}&limit=24`[^]*?payload\.videos\.filter\(\(item\) => item\?\.id && item\?\.videoUrl && item\?\.dancer\?\.stageName\)/,
  );
  assert.match(
    homeSource,
    /dancer\.href = dancerSlug \? `\/dancers\/\$\{encodeURIComponent\(dancerSlug\)\}` : "#"/,
  );
  assert.match(homeSource, /venue\.href = venueExperienceHref\([\s\S]*?\{ slug: venueSlug, name: venueName \}[\s\S]*?item\?\.dancer\?\.city \|\| citySelect\.value/);
  assert.match(homeSource, /"Working now"[\s\S]*?`Upcoming \$\{formatProfileTvShift/);
  assert.match(
    homeSource,
    /new IntersectionObserver\([\s\S]*?activateHomeTvFeedVideo/,
  );
  assert.match(
    homeSource,
    /class="home-feed-return-home"[\s\S]*?id="homeFeedReturnHomeBtn"[\s\S]*?aria-label="Return to the main city screen"[\s\S]*?<svg viewBox="0 0 24 24"/,
  );
  assert.match(
    homeSource,
    /results\.replaceChildren\(\s*\.\.\.homeTvFeedVideos\.map\(\(item, index\) => \(\s*createHomeTvFeedSlide\(item, index, homeTvFeedVideos\.length\)/,
  );
  assert.match(
    homeSource,
    /function renderHomeTvFeedLoading\(\) \{[\s\S]*?loading\.className = "home-tv-feed-loading"[\s\S]*?loading\.setAttribute\("role", "status"\)[\s\S]*?loading\.setAttribute\("aria-label", "Loading MyDancr TV"\)[\s\S]*?results\.replaceChildren\(loading\)/,
  );
  assert.match(
    homeSource,
    /\.home-feed-return-home \{[\s\S]*?position: fixed[\s\S]*?z-index: 110[\s\S]*?width: 46px[\s\S]*?height: 46px[\s\S]*?touch-action: manipulation/,
  );
  assert.match(
    homeSource,
    /body\.home-tv-feed-locked \.home-feed-return-home \{[\s\S]*?display: grid/,
  );
  assert.match(
    homeSource,
    /homeTvFeedStatus === "loading"[\s\S]*?results\.setAttribute\("aria-busy", "true"\)[\s\S]*?renderHomeTvFeedLoading\(\)[\s\S]*?results\.removeAttribute\("aria-busy"\)/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-loading \{[\s\S]*?place-items: center[\s\S]*?background: #000[\s\S]*?\.home-tv-feed-loading::after \{[\s\S]*?animation: homeTvFeedLoadingSpin \.8s linear infinite/,
  );
  assert.doesNotMatch(homeSource, /Loading approved MyDancr TV videos/);
  assert.doesNotMatch(homeSource, /homeTvDrawer|openHomeTvDrawer|closeHomeTvDrawer/);
});

test("the homepage starts neutral and discovery feeds open only after a destination tap", () => {
  assert.match(homeSource, /let activeTab = "tonight";[\s\S]*?let homeDiscoveryFeedOpen = false;/);
  assert.match(
    homeSource,
    /function returnToHomeDiscoveryMain\(\) \{[\s\S]*?deactivateHomeTvFeed\(\);[\s\S]*?homeDiscoveryFeedOpen = false;[\s\S]*?deactivateHomeDiscoveryFeed\(\);[\s\S]*?activeTab = "tonight";[\s\S]*?classList\.remove\("active"\)[\s\S]*?render\(\)[\s\S]*?window\.scrollTo\(\{ top: 0, left: 0, behavior: "smooth" \}\)/,
  );
  assert.match(
    homeSource,
    /homeFeedReturnHomeBtn\?\.addEventListener\("click", returnToHomeDiscoveryMain\);[\s\S]*?brandHome\.addEventListener\("click", returnToHomeDiscoveryMain\)/,
  );
});

test("Now, Dancers, and Venues use natural one-column browsing on phones", () => {
  assert.match(
    homeSource,
    /#results\.home-dancer-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important[\s\S]*?@media \(min-width: 680px\) \{[\s\S]*?#results\.home-dancer-grid \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?@media \(min-width: 900px\) \{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)[\s\S]*?@media \(min-width: 1100px\) \{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?\.home-dancer-grid-photo \{[\s\S]*?aspect-ratio: 1 \/ 1;/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid > \.home-dancer-grid-card \{[\s\S]*?height: auto !important;[\s\S]*?aspect-ratio: auto !important;/,
  );
  assert.match(
    homeSource,
    /activeTab = nextTab;[\s\S]*?homeDiscoveryFeedOpen =\s*nextTab === "venues" &&\s*homeDiscoveryFeedUsesInlineLayout\(\)/,
  );
  assert.match(
    homeSource,
    /const usesDiscoveryFeed =\s*homeDiscoveryFeedOpen &&\s*activeTab === "venues" &&\s*homeDiscoveryFeedUsesInlineLayout\(\);\s*if \(usesDiscoveryFeed\) \{\s*renderHomeDiscoveryFeed/,
  );
  assert.match(
    homeSource,
    /if \(activeTab === "tonight" \|\| activeTab === "dancers"\) \{\s*renderHomeDancerGrid\(city, items, activeTab\);\s*return;/,
  );
  assert.match(
    homeSource,
    /function renderHomeDancerGrid\(city, profiles, tab\)[\s\S]*?label: "Working Now"[\s\S]*?label: "Upcoming"[\s\S]*?label: "No Shift Posted"[\s\S]*?results\.classList\.add\("card-grid", "home-dancer-grid"\)/,
  );
});

test("Venues uses natural one-column cards with a visible next-card continuation", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed \{[\s\S]*?display: grid !important[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important[\s\S]*?overflow: visible !important[\s\S]*?scroll-snap-type: none[\s\S]*?touch-action: pan-y/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?width: 100% !important[\s\S]*?height: clamp\(460px, calc\(100dvh - 180px\), 580px\) !important[\s\S]*?scroll-snap-align: none !important/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed \{[\s\S]*?position: relative !important[\s\S]*?height: auto !important[\s\S]*?scroll-margin-top: 72px/,
  );
  assert.doesNotMatch(homeSource, /home-discovery-feed-locked|homeDiscoveryFeedPageLockY/);
  assert.match(
    homeSource,
    /activeTab = nextTab;[\s\S]*?homeDiscoveryFeedOpen =\s*nextTab === "venues" &&\s*homeDiscoveryFeedUsesInlineLayout\(\)[\s\S]*?render\(\)[\s\S]*?focusHomeResults/,
  );
  assert.match(
    homeSource,
    /function renderHomeDiscoveryFeed\(city, items, options = \{\}\)[\s\S]*?activeTab === "venues"[\s\S]*?homeVenueDiscoveryFeedSlide\(item, index, items\.length, city\)/,
  );
  assert.match(
    homeSource,
    /root: null,[\s\S]*?rootMargin: "-72px 0px -88px"[\s\S]*?activateHomeDiscoveryFeedItem/,
  );
  assert.match(
    homeSource,
    /homeDiscoveryFeedPositions\.set\(homeDiscoveryFeedPositionKey\(\), itemKey\)/,
  );
  assert.doesNotMatch(
    homeSource,
    /home-discovery-feed-close|data-home-discovery-close|closeHomeDiscoveryFeed/,
  );
  assert.match(
    homeSource,
    /const isVenueFeed = activeTab === "venues";[\s\S]*?classList\.toggle\("home-venue-discovery-feed", isVenueFeed\)[\s\S]*?"venue profiles"[\s\S]*?`Scroll through \$\{discoveryLabel\} in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /if \(!items\.length\)[\s\S]*?No dancers are working now[\s\S]*?No venues match your current filters[\s\S]*?No approved dancer profiles are available/,
  );
  assert.doesNotMatch(homeSource, /No upcoming shifts are posted for tonight|Now and Next appearances/);
});

test("TV remains the only snap feed while discovery cards use natural page scrolling", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?scroll-behavior: auto;[\s\S]*?scroll-padding-block: 0;[\s\S]*?-webkit-overflow-scrolling: touch;[\s\S]*?scrollbar-width: none;/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed \{[\s\S]*?display: grid[\s\S]*?overflow: visible[\s\S]*?scroll-snap-type: none[\s\S]*?scroll-margin-top: 72px/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?box-sizing: border-box;[\s\S]*?height: 100%;[\s\S]*?min-height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?contain: layout paint style;/,
  );
  assert.match(
    homeSource,
    /\.home-discovery-feed-slide \{[\s\S]*?box-sizing: border-box;[\s\S]*?height: clamp\(460px, calc\(100dvh - 180px\), 580px\);[\s\S]*?min-height: 460px;[\s\S]*?max-height: 580px;[\s\S]*?contain: layout paint style;/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedViewport\(\)[\s\S]*?viewportWidth === homeTvFeedViewportWidth[\s\S]*?viewportHeight === homeTvFeedViewportHeight[\s\S]*?activeIndex \* viewportHeight/,
  );
  assert.doesNotMatch(homeSource, /function syncHomeDiscoveryFeedViewport\(\)/);
  const snapSettler =
    homeSource.match(
      /function settleHomeSnapFeed\(\) \{[\s\S]*?(?=\n    function queueHomeSnapFeedSettle)/,
    )?.[0] || "";
  assert.match(snapSettler, /Math\.round\(results\.scrollTop \/ viewportHeight\)/);
  assert.match(snapSettler, /targetTop = index \* viewportHeight/);
  assert.doesNotMatch(snapSettler, /home-discovery-feed|activateHomeDiscoveryFeedItem/);
  assert.match(
    homeSource,
    /results\.addEventListener\("scroll", queueHomeSnapFeedSettle[\s\S]*?results\.addEventListener\("scrollend", settleHomeSnapFeed/,
  );
});

test("venue inline cards use production venue, schedule, revenue, and customer action data", () => {
  assert.match(
    homeSource,
    /function dedupePublicVenues\(venues\)[\s\S]*?publicVenueRecordScore\(venue\) > publicVenueRecordScore\(current\)[\s\S]*?return \[\.\.\.uniqueVenues\.values\(\)\]/,
  );
  assert.match(
    homeSource,
    /function publicVenueRecordScore\(venue\)[\s\S]*?venue\?\.slug === canonicalSlug \? 32 : 0[\s\S]*?venue\?\.activeDeal\?\.id[\s\S]*?venue\?\.qrCodeUrl/,
  );
  assert.match(
    homeSource,
    /function mergeLiveVenues\(existingVenues, liveVenues\)[\s\S]*?return dedupePublicVenues\(merged\)/,
  );
  assert.match(
    homeSource,
    /function applyLiveMarket\(city, dancers, tonightDancers, venues\)[\s\S]*?market\.venues = dedupePublicVenues\(liveVenues\)/,
  );
  assert.match(
    homeSource,
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\)[\s\S]*?venueDetails\(venue, city\)[\s\S]*?venueDancers\(city, venue\.name\)/,
  );
  assert.match(
    homeSource,
    /const workingNow = localProfiles[\s\S]*?isWorkingTonight\(profile, city\)[\s\S]*?const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?const workingNowMarkup = workingNow\.length[\s\S]*?<a class="home-discovery-feed-status is-now" href="\$\{venueHref\}"[\s\S]*?: "";/,
  );
  assert.match(
    homeSource,
    /home-venue-discovery-location[\s\S]*?details\.distanceLabel[\s\S]*?details\.hours[\s\S]*?displayShiftTime\(details\.hours\)[\s\S]*?accessibilityLabel = workingNow\.length/,
  );
  assert.match(
    homeSource,
    /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?sourceType: "club_page"[\s\S]*?data-club-deal-cta[\s\S]*?venue\.qrCodeUrl[\s\S]*?publishedVenueQrPass[\s\S]*?sourceType: "venue_page"[\s\S]*?data-deal-pass/,
  );
  const venueSlide = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.doesNotMatch(venueSlide, /home-discovery-feed-open-profile/);
  assert.doesNotMatch(venueSlide, /const upcoming|nextProfile|nextShiftMarkup|No upcoming dancer shifts posted/);
  assert.match(
    venueSlide,
    /home-discovery-feed-profile-button" href="\$\{venueHref\}"[\s\S]*?data-venue-follow="\$\{venueValue\}"[\s\S]*?data-account-action="venue-follow"/,
  );
  assert.match(venueSlide, /const directionsMarkup[\s\S]*?venue-directions-btn/);
  assert.match(
    homeSource,
    /const followVenueButton = event\.target\.closest\("\[data-venue-follow\]"\)[\s\S]*?requireCustomerAccountForProfileAction\(followVenueButton\)[\s\S]*?await postAuthenticatedJson\("\/api\/customer\/venue-follows"/,
  );
  assert.match(
    homeSource,
    /data-feed-venue-qr[\s\S]*?eventType: "qr_impression"[\s\S]*?"venue_page" : "dancer_profile"/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-art \{[\s\S]*?radial-gradient[\s\S]*?\.home-venue-discovery-deal-action \{[\s\S]*?linear-gradient/,
  );
});

test("Now and Dancers grid cards open the existing full profile as the only next level", () => {
  assert.match(
    homeSource,
    /function homeDancerGridCard\(profile\)[\s\S]*?publicProfilePhotoUrl\(profile\)[\s\S]*?class="dancer-card home-dancer-grid-card \$\{groupClass\}"[\s\S]*?class="home-dancer-grid-link" href="\$\{profileHref\}"[\s\S]*?homeDancerGridQrMarkup\(profile\)/,
  );
  assert.match(
    homeSource,
    /const photoMarkup = photoUrl[\s\S]*?home-dancer-grid-photo\$\{photoAttrs\.className\}[\s\S]*?aria-hidden="true"[\s\S]*?String\(profile\.name\)\.trim\(\)\.charAt\(0\)/,
  );
  assert.match(
    homeSource,
    /results\.addEventListener\("click", async \(event\) => \{[\s\S]*?const card = event\.target\.closest\("\.dancer-card"\);[\s\S]*?event\.preventDefault\(\);[\s\S]*?openProfileModal\(card\.dataset\.profile\);/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.profile-modal \{[\s\S]*?overflow-y: auto !important[\s\S]*?touch-action: pan-y !important/,
  );
});

test("Working Now dancer grid cards expose a functional production Club QR action", () => {
  assert.match(
    homeSource,
    /function homeDiscoveryFeedLiveQrData\(profile\) \{\s*if \(!isWorkingTonight\(profile\) \|\| !profile\.venueId\) return null;/,
  );
  assert.match(
    homeSource,
    /profile\.activeDeal\?\.id[\s\S]*?data-club-deal-cta[\s\S]*?profile\.venueQrCodeUrl[\s\S]*?publishedVenueQrPass[\s\S]*?data-deal-pass/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridQrMarkup\(profile\)[\s\S]*?homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?class="home-dancer-grid-qr"[\s\S]*?data-feed-live-qr[\s\S]*?<span>Club QR<\/span>/,
  );
  assert.match(
    homeSource,
    /results\.addEventListener\("click", async \(event\) => \{[\s\S]*?event\.target\.closest\("\[data-club-deal-cta\], \[data-deal-pass\]"\)[\s\S]*?await handleDealPassClick\(event\);[\s\S]*?return;/,
  );
  assert.match(
    homeSource,
    /trigger\.hasAttribute\("data-save-deal-pass-on-open"\)[\s\S]*?saveCustomerDealPass\(pass, "Club QR saved to Offers"\)[\s\S]*?openDealPassOverlay\(pass\)/,
  );
  assert.match(
    homeSource,
    /\.home-dancer-grid-qr \{[\s\S]*?position: absolute[\s\S]*?background: linear-gradient[\s\S]*?\.home-dancer-grid-qr:focus-visible \{/,
  );
});

test("bottom navigation keeps every destination on one uniform baseline", () => {
  assert.match(
    homeSource,
    /#discoveryTabs \.tab,\s*#discoveryTabs \.home-bottom-tv \{[\s\S]*?height: 57px !important[\s\S]*?grid-template-rows: 30px 14px !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \{[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab-count \{[\s\S]*?top: 4px !important[\s\S]*?left: calc\(50% \+ 12px\) !important[\s\S]*?max-width: none !important[\s\S]*?overflow: visible !important/,
  );
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?width: 30px !important[\s\S]*?height: 30px !important[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-bottom-tv,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active,[\s\S]*?#discoveryTabs \.home-bottom-tv\[aria-current="true"\] \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab::before,[\s\S]*?#discoveryTabs \.home-bottom-tv::after \{[\s\S]*?content: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?width: 30px !important[\s\S]*?height: 30px !important[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\[data-tab="dancers"\] \{[\s\S]*?--home-nav-accent: #c084fc[\s\S]*?#discoveryTabs \.home-bottom-tv \{[\s\S]*?--home-nav-accent: #f472b6/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?color: var\(--home-nav-accent\) !important[\s\S]*?drop-shadow\(0 0 3px var\(--home-nav-accent-glow\)\)[\s\S]*?drop-shadow\(0 0 7px rgba\(124,58,237,\.22\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon \{[\s\S]*?color: #fff !important[\s\S]*?drop-shadow\(0 0 2px var\(--home-nav-hero-white-glow\)\)[\s\S]*?drop-shadow\(0 0 7px var\(--home-nav-hero-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 13px var\(--home-nav-hero-cyan-glow\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-label,[\s\S]*?color: #fff[\s\S]*?var\(--home-nav-hero-white-glow\)[\s\S]*?var\(--home-nav-hero-violet-glow\)[\s\S]*?var\(--home-nav-hero-cyan-glow\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab-count \{[\s\S]*?border: 0 !important[\s\S]*?color: var\(--home-nav-accent-soft\) !important[\s\S]*?background: transparent !important[\s\S]*?pointer-events: none/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\[data-tab="trending"\] \.tab-count \{[\s\S]*?right: calc\(50% - 22px\) !important[\s\S]*?left: auto !important[\s\S]*?text-align: right/,
  );
});

test("legal and support actions stay out of the mobile discovery scroll", () => {
  const homeMain = homeSource.match(/<main class="stack">[\s\S]*?<\/main>/)?.[0] || "";
  const accountMenu = homeSource.match(
    /<div class="utility-menu-panel" id="moreMenuPanel"[\s\S]*?<\/nav>[\s\S]*?<\/div>/,
  )?.[0] || "";
  assert.doesNotMatch(homeMain, /legal-links|data-legal-page|contactAdminBtn|adminBtn/);
  assert.match(
    accountMenu,
    /class="utility-menu-legal"[\s\S]*?data-legal-page="termsPage"[\s\S]*?data-legal-page="privacyPage"[\s\S]*?data-legal-page="guidelinesPage"[\s\S]*?href="\/dmca"[\s\S]*?id="contactAdminBtn"[\s\S]*?id="adminBtn"/,
  );
  assert.match(
    accountMenu,
    /class="utility-menu-item utility-menu-dashboard" id="dashboardBtn"[\s\S]*?<nav class="utility-menu-legal"[\s\S]*?<div class="utility-menu-session-end" id="sessionMenuEnd" hidden>[\s\S]*?class="utility-menu-item utility-menu-logout" id="logoutBtn"/,
  );
  assert.match(
    homeSource,
    /\.utility-menu-panel \{[\s\S]*?max-height: calc\(100dvh - 84px\)[\s\S]*?overflow-y: auto/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\)[\s\S]*?header \{[\s\S]*?z-index: 120 !important[\s\S]*?header \.utility-menu-panel \{[\s\S]*?max-height: calc\(100dvh - 150px\) !important/,
  );
  assert.match(
    homeSource,
    /\.utility-menu-dashboard \{[\s\S]*?linear-gradient\(135deg, rgba\(124,58,237,.98\), rgba\(8,145,178,.94\)\)[\s\S]*?box-shadow:/,
  );
  assert.match(
    homeSource,
    /\.utility-menu-dashboard\[hidden\] \{[\s\S]*?display: none[\s\S]*?\.utility-menu-dashboard\[hidden\]::after \{[\s\S]*?content: none/,
  );
  assert.match(
    homeSource,
    /\.utility-menu-session-end \{[\s\S]*?border-top: 1px solid rgba\(251,113,133,.18\)[\s\S]*?\.utility-menu-logout \{[\s\S]*?color: #fecdd3[\s\S]*?background: rgba\(69,10,24,.34\)/,
  );
  assert.match(
    homeSource,
    /dashboardBtn\.hidden = !loggedIn;[\s\S]*?sessionMenuEnd\.hidden = !loggedIn;/,
  );
});

test("mobile homepage cards form a single-column production action feed", () => {
  assert.match(homeSource, /#results\.card-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(homeSource, /#results \.home-feed-card \.portrait \{[\s\S]*aspect-ratio: 4 \/ 5/);
  assert.match(
    homeSource,
    /options\.feedActions[\s\S]*data-feed-action="follow"[\s\S]*data-feed-action="notify"[\s\S]*data-feed-action="going"/,
  );
  assert.match(
    homeSource,
    /feedActions: true/,
  );
  assert.match(
    homeSource,
    /const feedActionButton = event\.target\.closest\("\[data-feed-action\]"\)[\s\S]*saveProfileFollow\(feedActionButton\)[\s\S]*saveProfileNotifications\(feedActionButton\)[\s\S]*saveProfileGoing\(feedActionButton\)/,
  );
  assert.match(
    homeSource,
    /grid-template-columns: minmax\(0, \.9fr\) minmax\(0, \.9fr\) minmax\(0, 1\.2fr\)/,
  );
  assert.match(homeSource, /\.feed-card-action \{[\s\S]*?min-height: 54px/);
  assert.match(
    homeSource,
    /const canMarkGoing = Boolean\(workingTonight && profile\.shiftId\)[\s\S]*?const goingActionMarkup = canMarkGoing[\s\S]*?data-shift-state="tonight"[\s\S]*?: "";/,
  );
  assert.match(
    homeSource,
    /\.feed-card-actions\.without-going \{[\s\S]*?grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/,
  );
  assert.match(
    homeSource,
    /\.feed-card-action\[data-feed-action="going"\] \{[\s\S]*?linear-gradient[\s\S]*?\.feed-card-action\[data-feed-action="going"\]\.is-active/,
  );
  assert.match(homeSource, /isNotified \? "Notifications On" : "Notify"/);
  assert.match(homeSource, /homeFeedGoingActionMarkup\(profile, isGoing\)/);
  assert.match(homeSource, /postAuthenticatedJson\("\/api\/customer\/follows"/);
  assert.match(homeSource, /postOptionalAuthJson\("\/api\/customer\/going"/);
});

test("homepage omits top search and city shortcut controls", () => {
  assert.doesNotMatch(homeSource, /homeHeaderSearch(?:Toggle|Panel|Input|Clear)/);
  assert.doesNotMatch(homeSource, /class="desktop-search"/);
  assert.doesNotMatch(homeSource, /homeSearchQuery|applySearchValue|Search dancers or venues/);
  assert.doesNotMatch(homeSource, /homeHeaderCity|home-header-(?:discovery|city)/);
  assert.match(homeSource, /<select id="citySelect">/);
  assert.match(homeSource, /const allItems = getItems\(city, activeTab\)/);
  assert.doesNotMatch(homeSource, /\.brand \{\s*display: none;\s*\}/);
});

test("mobile dancer headings keep the selected city on one clean line", () => {
  assert.match(
    homeSource,
    /const keepDancerCityOnOneLine =\s*!selectedVenue && activeTab === "dancers" && venueFilter === "all";/,
  );
  assert.match(
    homeSource,
    /tabTitle\.classList\.toggle\("dancers-city-title", keepDancerCityOnOneLine\);/,
  );
  assert.match(
    homeSource,
    /cityTitle\.className = "tab-title-city";[\s\S]*?cityTitle\.textContent = city;[\s\S]*?tabTitle\.replaceChildren\(document\.createTextNode\("Dancers in "\), cityTitle\);/,
  );
  assert.match(
    homeSource,
    /#tabTitle\.dancers-city-title \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;[\s\S]*?font-size: clamp\(22px, 6vw, 25px\) !important;/,
  );
  assert.match(homeSource, /#tabTitle \.tab-title-city \{[\s\S]*?white-space: nowrap;/);
});
