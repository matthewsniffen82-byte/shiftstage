import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("mobile discovery uses one consolidated Dancers destination beside TV and Venues", () => {
  const navigation = homeSource.match(
    /<nav class="tabs" id="discoveryTabs"[\s\S]*?<\/nav>/,
  )?.[0] || "";
  assert.match(
    navigation,
    /data-tab="dancers"[\s\S]*id="homeBottomTv"[\s\S]*data-tab="venues"/,
  );
  assert.match(
    navigation,
    /class="tab active" data-tab="dancers" data-tab-label="Dancers" aria-current="page"/,
  );
  assert.doesNotMatch(navigation, /data-tab="(?:tonight|trending)"/);
  assert.match(navigation, /id="homeBottomTv"[^>]*aria-controls="results"[^>]*aria-current="false"/);
  assert.doesNotMatch(navigation, /id="homeBottomTv"[^>]*href=/);
  assert.match(homeSource, /#discoveryTabs \{[\s\S]*position: fixed !important[\s\S]*grid-template-columns: repeat\(3/);
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
  assert.match(homeSource, /@media \(max-width: 720px\)[\s\S]*?\.home-tv-launch \{\s*display: none !important/);
  assert.match(
    homeSource,
    /bottomTv\.setAttribute\("aria-label", `Show MyDancr TV \$\{scopeLabel\} videos in the Home feed`\)/,
  );
});

test("the Home TV button renders a larger mobile snap-scroll feed without leaving Home", () => {
  assert.match(homeSource, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?max-width: 720px[\s\S]*?display: grid[\s\S]*?overflow: visible[\s\S]*?scroll-snap-type: none[\s\S]*?\.home-tv-feed-slide \{[\s\S]*?height: clamp\(560px, calc\(100svh - 140px\), 760px\)[\s\S]*?border-radius: 18px/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?overscroll-behavior-y: auto[\s\S]*?touch-action: pan-y/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?html\.home-tv-page-snap \{[\s\S]*?scroll-snap-type: y proximity;[\s\S]*?#results\.home-tv-feed \{[\s\S]*?width: calc\(100% \+ 14px\) !important;[\s\S]*?height: auto !important;[\s\S]*?margin: 0 -7px calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?grid-auto-rows: auto;[\s\S]*?overflow: visible !important;[\s\S]*?scroll-snap-type: none;[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?height: clamp\(520px, calc\(100svh - 112px\), 920px\) !important;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: normal;/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?activeTab = nextTab;[\s\S]*?render\(\);[\s\S]*?options\.scroll !== false[\s\S]*?focusHomeResults\(\)/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive|requestHomeDestinationFullscreen|focusAndLockHomeTvFeed/);
  assert.match(
    homeSource,
    /const params = new URLSearchParams\(\{ city, limit: "24" \}\);[^]*?if \(venueId\) params\.set\("venue", venueId\);[^]*?fetch\(`\/api\/public\/tv\?\$\{params\.toString\(\)\}`[^]*?payload\.videos\.filter\(\(item\) => \([^]*?item\?\.id[^]*?item\?\.videoUrl[^]*?item\?\.dancer\?\.stageName[^]*?!venueId \|\| item\?\.venue\?\.id === venueId/,
  );
  assert.match(
    homeSource,
    /const profileHref = dancerSlug[\s\S]*?`\/\?city=\$\{encodeURIComponent\(dancerCity\)\}&profile=\$\{encodeURIComponent\(dancerSlug\)\}`[\s\S]*?: "#"[\s\S]*?dancer\.href = profileHref/,
  );
  assert.match(
    homeSource,
    /const openDancerProfile = \(event\) => \{[\s\S]*?markets\[dancerCity\]\?\.dancers\.find[\s\S]*?profileItem\.slug === dancerSlug && isApprovedPublicProfile\(profileItem\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?openProfileModal\(profileReferenceValue\(profile\)\)[\s\S]*?dancer\.addEventListener\("click", openDancerProfile\)/,
  );
  assert.match(homeSource, /venue\.href = venueExperienceHref\([\s\S]*?\{ slug: venueSlug, name: venueName \}[\s\S]*?item\?\.dancer\?\.city \|\| citySelect\.value/);
  assert.match(homeSource, /"Working Now"[\s\S]*?dateLabel \? `Upcoming · \$\{dateLabel\}` : "Upcoming"/);
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
  assert.doesNotMatch(homeSource, /groupHomeTvFeedVideos/);
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
    /homeTvFeedStatus === "loading"[\s\S]*?results\.setAttribute\("aria-busy", "true"\)[\s\S]*?renderHomeTvFeedLoading\(\)[\s\S]*?results\.removeAttribute\("aria-busy"\)/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-loading \{[\s\S]*?place-items: center[\s\S]*?background: #000[\s\S]*?\.home-tv-feed-loading::after \{[\s\S]*?animation: homeTvFeedLoadingSpin \.8s linear infinite/,
  );
  assert.doesNotMatch(homeSource, /Loading approved MyDancr TV videos/);
  assert.doesNotMatch(homeSource, /homeTvDrawer|openHomeTvDrawer|closeHomeTvDrawer/);
});

test("the homepage selects Dancers on first load and keeps destination navigation authoritative", () => {
  assert.match(homeSource, /let activeTab = "dancers";[\s\S]*?let dancerDirectoryFilter = "all";[\s\S]*?let homeDiscoveryFeedOpen = false;/);
  assert.match(
    homeSource,
    /<button class="tab active" data-tab="dancers" data-tab-label="Dancers" aria-current="page">Dancers<\/button>/,
  );
  assert.match(
    homeSource,
    /function returnToHomeDiscoveryMain\(\) \{\s*if \(profileBackdrop\.classList\.contains\("show"\)\) return false;[\s\S]*?activateHomeDestination\("dancers", \{ dancerFilter: "all", scroll: false \}\);[\s\S]*?window\.scrollTo\(\{ top: 0, left: 0, behavior: "smooth" \}\)/,
  );
  assert.match(
    homeSource,
    /homeFeedReturnHomeBtn\?\.addEventListener\("click", returnToHomeDiscoveryMain\);[\s\S]*?brandHome\.addEventListener\("click", returnToHomeDiscoveryMain\)/,
  );
  assert.match(
    homeSource,
    /function homeDestinationFromLocation\(\) \{[\s\S]*?requestedView === "tonight" \|\| requestedView === "trending"[\s\S]*?return "dancers"[\s\S]*?homeDestinationOrder\.includes\(requestedView\) \? requestedView : "dancers"[\s\S]*?const initialHomeDestinationRequested = homeDestinationWasRequested\(\);[\s\S]*?const initialHomeDestination = homeDestinationFromLocation\(\);[\s\S]*?const isActive = item\.dataset\.tab === initialHomeDestination;[\s\S]*?setAttribute\("aria-current", isActive \? "page" : "false"\)/,
  );
  assert.match(
    homeSource,
    /document\.querySelectorAll\("\.tab"\)\.forEach\(\(item\) => \{[\s\S]*?const isActive = item\.dataset\.tab === nextTab;[\s\S]*?classList\.toggle\("active", isActive\);[\s\S]*?setAttribute\("aria-current", isActive \? "page" : "false"\)/,
  );
  assert.doesNotMatch(
    homeSource,
    /function returnToHomeDiscoveryMain\(\) \{[\s\S]*?document\.querySelectorAll\("\.tab"\)[\s\S]*?classList\.remove\("active"\)/,
  );
});

test("all three destinations land at their title before the cards", () => {
  assert.match(
    homeSource,
    /const homeDestinationOrder = \["dancers", "tv", "venues"\];/,
  );
  assert.match(
    homeSource,
    /function homeResultsDocumentTop\(element\) \{[\s\S]*?Number\(node\.offsetTop\)[\s\S]*?node = node\.offsetParent[\s\S]*?function alignHomeResultsTitle\(\) \{[\s\S]*?tabTitle\?\.closest\("\.content-head"\)[\s\S]*?getComputedStyle\(destinationStart\)\.top[\s\S]*?homeResultsDocumentTop\(destinationStart\) - landingTop[\s\S]*?window\.scrollTo\(\{ top: targetTop, left: 0, behavior: "auto" \}\)/,
  );
  assert.match(
    homeSource,
    /function cancelHomeResultsFocus\(\{ releaseTvLanding = false \} = \{\}\) \{[\s\S]*?cancelAnimationFrame\(homeResultsFocusFrame\)[\s\S]*?clearTimeout\(homeResultsFocusTimer\)[\s\S]*?homeResultsFocusRun \+= 1[\s\S]*?releaseTvLanding\) homeTvFeedLandingPending = false;[\s\S]*?function focusHomeResults\(\) \{[\s\S]*?cancelHomeResultsFocus\(\);[\s\S]*?const focusRun = homeResultsFocusRun[\s\S]*?alignHomeResultsTitle\(\)[\s\S]*?requestAnimationFrame\(\(\) => settle\(remainingFrames - 1\)\)[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?alignHomeResultsTitle\(\)[\s\S]*?160/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\)[\s\S]*?activeTab = nextTab;[\s\S]*?homeTvFeedLandingPending = nextTab === "tv" && options\.scroll !== false;[\s\S]*?render\(\);[\s\S]*?if \(options\.scroll !== false\) \{[\s\S]*?focusHomeResults\(\)/,
  );
  assert.match(homeSource, /let homeTvFeedLandingPending = false;/);
  assert.match(
    homeSource,
    /function settleHomeTvFeedLanding\(\{ complete = false \} = \{\}\) \{[\s\S]*?if \(!homeTvFeedLandingPending\) return;[\s\S]*?focusHomeResults\(\);[\s\S]*?if \(complete\) homeTvFeedLandingPending = false;/,
  );
  assert.match(
    homeSource,
    /homeTvFeedStatus === "loading"[\s\S]*?renderHomeTvFeedLoading\(\);[\s\S]*?settleHomeTvFeedLanding\(\);[\s\S]*?results\.replaceChildren\([\s\S]*?settleHomeTvFeedLanding\(\{ complete: true \}\);/,
  );
  assert.match(
    homeSource,
    /homeTvFeedLandingPending = initialHomeDestinationRequested && initialHomeDestination === "tv";[\s\S]*?render\(\);[\s\S]*?if \(initialHomeDestinationRequested\) \{[\s\S]*?focusHomeResults\(\)/,
  );
  assert.match(
    homeSource,
    /\.content-head \{[\s\S]*?scroll-margin-top: calc\(14px \+ env\(safe-area-inset-top\)\)/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?html\.home-tv-page-snap \{[\s\S]*?scroll-snap-type: y proximity;[\s\S]*?scroll-padding-top: calc\(14px \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*?#results\.home-tv-feed \{[\s\S]*?margin: 0 -7px calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-snap-type: none;/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive/);
});

test("manual scrolling releases the initial title landing without disabling page snap", () => {
  assert.match(
    homeSource,
    /const homeResultsScrollIntentKeys = new Set\(\[[\s\S]*?"ArrowUp"[\s\S]*?"ArrowDown"[\s\S]*?"PageUp"[\s\S]*?"PageDown"[\s\S]*?"Home"[\s\S]*?"End"[\s\S]*?" "[\s\S]*?"Spacebar"[\s\S]*?\]\);/,
  );
  assert.match(
    homeSource,
    /function releaseHomeResultsLandingForUser\(event\) \{[\s\S]*?event\.type === "keydown"[\s\S]*?homeResultsScrollIntentKeys\.has\(event\.key\)[\s\S]*?cancelHomeResultsFocus\(\{ releaseTvLanding: true \}\);/,
  );
  assert.match(
    homeSource,
    /window\.addEventListener\("touchstart", releaseHomeResultsLandingForUser, \{ passive: true, capture: true \}\);[\s\S]*?window\.addEventListener\("wheel", releaseHomeResultsLandingForUser, \{ passive: true, capture: true \}\);[\s\S]*?window\.addEventListener\("keydown", releaseHomeResultsLandingForUser, \{ capture: true \}\);/,
  );
  assert.match(homeSource, /html\.home-tv-page-snap \{[\s\S]*?scroll-snap-type: y proximity;/);
});

test("mobile discovery keeps the active title and destination dock visible while results scroll", () => {
  assert.match(
    homeSource,
    /<div class="content-head discovery-sticky-head">\s*<h2 id="tabTitle">/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?\.app \{\s*overflow: visible !important;[\s\S]*?\.discovery-sticky-head \{[\s\S]*?position: sticky;[\s\S]*?top: calc\(18px \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*?z-index: 70;[\s\S]*?scroll-margin-top: 0;/,
  );
  assert.match(
    homeSource,
    /\.discovery-sticky-head \+ #results \{[\s\S]*?min-height: calc\(100svh - 112px\) !important;[\s\S]*?align-content: start;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?position: fixed !important;[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.doesNotMatch(
    homeSource,
    /\.discovery-sticky-head \{[\s\S]*?position: fixed;/,
  );
});

test("Dancers uses grouped grid browsing while Venues retains its inline feed", () => {
  assert.match(
    homeSource,
    /activeTab = nextTab;[\s\S]*?homeDiscoveryFeedOpen =\s*nextTab === "venues" &&\s*homeDiscoveryFeedUsesInlineLayout\(\)/,
  );
  assert.match(
    homeSource,
    /const usesDiscoveryFeed =\s*activeTab === "venues" &&\s*!selectedVenue &&\s*homeDiscoveryFeedUsesInlineLayout\(\);[\s\S]*?homeDiscoveryFeedOpen = usesDiscoveryFeed;\s*if \(usesDiscoveryFeed\) \{\s*renderHomeDiscoveryFeed/,
  );
  assert.match(
    homeSource,
    /if \(activeTab === "dancers"\) \{\s*renderHomeDancerGrid\(city, items\);\s*return;/,
  );
  assert.match(
    homeSource,
    /function dancerDirectorySections\(profiles, city\)[\s\S]*?label: "Working Now"[\s\S]*?label: "Trending"[\s\S]*?label: "Upcoming"[\s\S]*?label: "No Shift Posted"/,
  );
});

test("mobile venue filters cannot flash the retired venue grid before the inline feed settles", () => {
  const renderSource = homeSource.match(
    /function render\(\) \{[\s\S]*?(?=\n    async function renderHomeTvLaunch)/,
  )?.[0] || "";

  assert.match(
    renderSource,
    /const usesDiscoveryFeed =\s*activeTab === "venues" &&\s*!selectedVenue &&\s*homeDiscoveryFeedUsesInlineLayout\(\);/,
  );
  assert.match(
    renderSource,
    /homeDiscoveryFeedOpen = usesDiscoveryFeed;\s*if \(usesDiscoveryFeed\) \{\s*renderHomeDiscoveryFeed\(city, allItems/,
  );
  assert.ok(
    renderSource.indexOf("homeDiscoveryFeedOpen = usesDiscoveryFeed;") <
      renderSource.indexOf('results.classList.toggle("venue-card-grid"'),
    "mobile venue rendering must select the inline feed before the legacy grid branch",
  );
});

test("Dancers uses extra-tall portrait tiles in a near-seamless three-column grid", () => {
  assert.match(
    homeSource,
    /#results\.home-dancer-grid\.home-dancer-three-column \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;[\s\S]*?gap: 2px !important;/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid\.home-dancer-three-column > \.home-dancer-grid-card \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 0 !important;[\s\S]*?max-height: none !important;[\s\S]*?aspect-ratio: 9 \/ 16 !important;[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 2px !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    homeSource,
    /phone grid keeps the same near-seamless gutter[\s\S]*?@media \(max-width: 420px\) \{[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column \{[\s\S]*?width: calc\(100% \+ 16px\) !important;[\s\S]*?margin-inline: -8px !important;[\s\S]*?padding-right: max\(12px, env\(safe-area-inset-right, 0px\)\) !important;[\s\S]*?padding-bottom: calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?gap: 2px !important;[\s\S]*?scroll-padding-bottom: calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridCard\(profile, city, compactDirectory = false\)[\s\S]*?class="home-dancer-grid-link" href="\$\{profileHref\}"[\s\S]*?\$\{compactDirectory \? "" : homeDancerGridActionsMarkup\(profile, city\)\}/,
  );
  assert.match(
    homeSource,
    /function renderHomeDancerGrid\(city, profiles\)[\s\S]*?results\.classList\.add\("home-dancer-three-column"\)[\s\S]*?homeDancerGridSectionMarkup\(section\.label, section\.className, section\.profiles, city, true\)/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid\.home-dancer-three-column \.home-dancer-grid-venue \{[\s\S]*?gap: 2px;[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column \.home-dancer-grid-venue > \.venue-dot \{[\s\S]*?width: 10px;[\s\S]*?flex: 0 0 10px;[\s\S]*?margin-right: 0;/,
  );
});

test("Dancers reuses unchanged grid cards and keeps compact photos stable during touch scrolling", () => {
  const contentKey = homeSource.match(
    /function homeDancerGridContentKey\(city, markup\) \{[\s\S]*?(?=\n    function renderHomeDancerGrid)/,
  )?.[0] || "";
  const renderer = homeSource.match(
    /function renderHomeDancerGrid\(city, profiles\) \{[\s\S]*?(?=\n    function homeDiscoveryFeedSlide)/,
  )?.[0] || "";
  const compactCardRule = homeSource.match(
    /#results\.home-dancer-grid\.home-dancer-three-column > \.home-dancer-grid-card \{[^}]*\}/,
  )?.[0] || "";

  assert.match(contentKey, /city,/);
  assert.match(contentKey, /filter: dancerDirectoryFilter/);
  assert.match(contentKey, /venueFilter: selectedVenueFilter\(\)/);
  assert.match(contentKey, /markup/);
  assert.match(renderer, /const gridMarkup = `/);
  assert.match(renderer, /const nextRenderKey = homeDancerGridContentKey\(city, gridMarkup\)/);
  assert.match(
    renderer,
    /homeDancerGridRenderKey === nextRenderKey[\s\S]*?results\.querySelector\(":scope > \.dancer-directory-filters"\)[\s\S]*?return;/,
  );
  assert.match(renderer, /homeDancerGridRenderKey = nextRenderKey;[\s\S]*?results\.innerHTML = gridMarkup;/);
  assert.match(compactCardRule, /contain: layout style;/);
  assert.doesNotMatch(compactCardRule, /contain: layout paint style;/);
  assert.match(
    homeSource,
    /Keep compact directory tiles in the normal mobile paint flow[\s\S]*?@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column > \.home-dancer-grid-card,[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column \.home-dancer-grid-link,[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column \.home-dancer-grid-photo \{[\s\S]*?-webkit-backface-visibility: visible !important;[\s\S]*?backface-visibility: visible !important;/,
  );
});

test("Venues uses natural one-column cards with a visible next-card continuation", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed \{[\s\S]*?display: grid !important[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important[\s\S]*?overflow: visible !important[\s\S]*?scroll-snap-type: none[\s\S]*?touch-action: pan-y/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?width: 100% !important[\s\S]*?height: clamp\(420px, calc\(100vh - 230px\), 540px\) !important[\s\S]*?height: clamp\(420px, calc\(100svh - 230px\), 540px\) !important[\s\S]*?scroll-snap-align: none !important/,
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
    /const isVenueFeed = activeTab === "venues";[\s\S]*?classList\.toggle\("home-venue-discovery-feed", isVenueFeed\)[\s\S]*?"club profiles"[\s\S]*?`Scroll through \$\{discoveryLabel\} in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /if \(!items\.length\)[\s\S]*?No dancers are working now[\s\S]*?No clubs match your current filters[\s\S]*?No approved dancer profiles are available/,
  );
  assert.doesNotMatch(homeSource, /No upcoming shifts are posted for tonight|Now and Next appearances/);
});

test("venue cards keep every active venue above inactive venues, then preserve schedule and popularity priority", () => {
  assert.match(
    homeSource,
    /function mapLiveVenue\(item, city, venueShiftCounts\) \{[\s\S]*?popularity: \{[\s\S]*?followerCount: Math\.max\(0, Number\(item\.popularity\?\.followerCount\) \|\| 0\)[\s\S]*?directionRequests30d:[\s\S]*?profileViews30d:/,
  );
  assert.match(
    homeSource,
    /function venueSchedulePriority\(venue, city\) \{[\s\S]*?venueDancers\(city, venue\.name\)[\s\S]*?isWorkingTonight\(profile, city\)[\s\S]*?return 0;[\s\S]*?profile\.scheduled[\s\S]*?return 1;[\s\S]*?return 2;/,
  );
  assert.match(
    homeSource,
    /function venueDiscoveryIsActiveNow\(venue, city\) \{[\s\S]*?venueDancers\(city, venue\.name\)[\s\S]*?isWorkingTonight\(profile, city\)[\s\S]*?if \(hasWorkingDancer\) return true;[\s\S]*?venueOperatingStatus\(venue\?\.hours \|\| "", city\)\.state === "open";/,
  );
  assert.match(
    homeSource,
    /function compareVenuePopularity\(left, right\) \{[\s\S]*?rightPopularity\.followerCount[\s\S]*?leftPopularity\.followerCount[\s\S]*?rightPopularity\.directionRequests30d[\s\S]*?leftPopularity\.directionRequests30d[\s\S]*?rightPopularity\.profileViews30d[\s\S]*?leftPopularity\.profileViews30d/,
  );
  assert.match(
    homeSource,
    /function compareVenueDiscoveryPriority\(left, right, city\) \{[\s\S]*?Number\(venueDiscoveryIsActiveNow\(right, city\)\) - Number\(venueDiscoveryIsActiveNow\(left, city\)\)[\s\S]*?venueSchedulePriority\(left, city\) - venueSchedulePriority\(right, city\)[\s\S]*?activeDifference \|\| scheduleDifference \|\| compareVenuePopularity\(left, right\) \|\| compareVenueDistance\(left, right, city\)/,
  );
  assert.match(
    homeSource,
    /if \(tab === "venues"\) \{[\s\S]*?\.filter\(venueMatchesCurrentFilter\)[\s\S]*?\.sort\(\(a, b\) => compareVenueDiscoveryPriority\(a, b, city\)\)/,
  );
});

test("TV uses document-level mobile snapping while discovery cards keep natural page scrolling", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?display: grid;[\s\S]*?overflow: visible;[\s\S]*?scroll-snap-type: none;/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed \{[\s\S]*?display: grid[\s\S]*?overflow: visible[\s\S]*?scroll-snap-type: none[\s\S]*?scroll-margin-top: 72px/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?box-sizing: border-box;[\s\S]*?height: clamp\(560px, calc\(100svh - 140px\), 760px\);[\s\S]*?min-height: 560px;[\s\S]*?max-height: 760px;[\s\S]*?contain: layout paint style;/,
  );
  assert.match(
    homeSource,
    /\.home-discovery-feed-slide \{[\s\S]*?box-sizing: border-box;[\s\S]*?height: clamp\(420px, calc\(100vh - 230px\), 540px\);[\s\S]*?height: clamp\(420px, calc\(100svh - 230px\), 540px\);[\s\S]*?min-height: 420px;[\s\S]*?max-height: 540px;[\s\S]*?contain: layout paint style;/,
  );
  assert.match(
    homeSource,
    /html\.home-tv-page-snap \{[\s\S]*?scroll-snap-type: y proximity;[\s\S]*?scroll-padding-bottom: calc\(80px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*?#results\.home-tv-feed \{[\s\S]*?height: auto !important;[\s\S]*?overflow: visible !important;[\s\S]*?overscroll-behavior-y: auto;[\s\S]*?scroll-snap-type: none;/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?height: clamp\(520px, calc\(100svh - 112px\), 920px\) !important;[\s\S]*?min-height: 520px !important;[\s\S]*?max-height: 920px !important;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: normal;/,
  );
  assert.match(homeSource, /const homeTvFeedSnapMedia = window\.matchMedia\("\(max-width: 720px\)"\)/);
  assert.match(homeSource, /root: null,[\s\S]*?rootMargin: "-72px 0px -88px"/);
  assert.match(homeSource, /function showRelativeHomeTvFeedSlide[\s\S]*?nextSlide\.scrollIntoView\(\{ block: "start", behavior: "smooth" \}\)/);
  assert.doesNotMatch(homeSource, /results\.scrollTo\(\{ top: nextSlide\.offsetTop/);
  assert.doesNotMatch(homeSource, /function syncHomeDiscoveryFeedViewport\(\)/);
  assert.doesNotMatch(
    homeSource,
    /homeSnapFeedSettleTimer|settleHomeSnapFeed|queueHomeSnapFeedSettle/,
  );
  assert.doesNotMatch(
    homeSource,
    /visualViewport\?\.addEventListener\("scroll", queueHomeTvFeedViewportSync/,
  );
});

test("mobile TV uses a quiet page-scroll thumb at the true viewport edge", () => {
  assert.match(
    homeSource,
    /html\.home-tv-page-snap \{[\s\S]*?scrollbar-width: none;[\s\S]*?html\.home-tv-page-snap::-webkit-scrollbar,[\s\S]*?html\.home-tv-page-snap body::-webkit-scrollbar \{[\s\S]*?width: 0;[\s\S]*?display: none;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-page-scroll-rail \{[\s\S]*?position: fixed;[\s\S]*?right: 2px;[\s\S]*?width: 2px;[\s\S]*?pointer-events: none;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-page-scroll-thumb \{[\s\S]*?width: 2px;[\s\S]*?min-height: 48px;[\s\S]*?background: rgba\(226, 232, 240, \.2\);[\s\S]*?transition: background-color \.18s ease, box-shadow \.18s ease;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-page-scroll-rail\.is-scrolling \.home-tv-page-scroll-thumb \{[\s\S]*?background: rgba\(226, 232, 240, \.46\);/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvPageScrollIndicator\(\) \{[\s\S]*?document\.scrollingElement \|\| document\.documentElement;[\s\S]*?scroller\.scrollHeight[\s\S]*?scroller\.scrollTop \/ maxScroll[\s\S]*?translate3d\(0, \$\{thumbOffset\}px, 0\)/,
  );
  assert.match(
    homeSource,
    /function markHomeTvPageScrollIndicatorActive\(\) \{[\s\S]*?classList\.add\("is-scrolling"\)[\s\S]*?window\.setTimeout\([\s\S]*?classList\.remove\("is-scrolling"\);[\s\S]*?\}, 700\);[\s\S]*?window\.addEventListener\("scroll", markHomeTvPageScrollIndicatorActive, \{ passive: true \}\);[\s\S]*?window\.visualViewport\?\.addEventListener\("resize", queueHomeTvPageScrollIndicatorSync, \{ passive: true \}\);/,
  );
});

test("venue inline cards use production venue, schedule, revenue, and customer action data", () => {
  assert.match(
    homeSource,
    /function mergePublicVenueRecords\(preferred, alternate\)[\s\S]*?hours: preferred\?\.hours \|\| alternate\?\.hours \|\| ""[\s\S]*?popularity:[\s\S]*?Math\.max\(Number\(preferredPopularity\.profileViews30d\)[\s\S]*?function dedupePublicVenues\(venues\)[\s\S]*?const preferred = publicVenueRecordScore\(venue\) > publicVenueRecordScore\(current\)[\s\S]*?mergePublicVenueRecords\(preferred, alternate\)[\s\S]*?return \[\.\.\.uniqueVenues\.values\(\)\]/,
  );
  const venueDedupeSource = homeSource.match(
    /function publicVenueRecordScore\(venue\) \{[\s\S]*?(?=\n    function mergeLiveVenues)/,
  )?.[0] || "";
  assert.ok(venueDedupeSource, "the production venue dedupe helpers must exist");
  const dedupeVenueRecords = new Function(
    "slugify",
    `${venueDedupeSource}; return dedupePublicVenues;`,
  )((value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  const mergedVenue = dedupeVenueRecords([
    {
      id: "canonical",
      slug: "little-darlings-las-vegas",
      name: "Little Darlings Las Vegas",
      address: "1514 Western Ave, Las Vegas, NV 89102",
      hours: "",
      popularity: { followerCount: 0, directionRequests30d: 4, profileViews30d: 18 },
    },
    {
      id: "legacy",
      slug: "little-darlings",
      name: "Little Darlings Las Vegas",
      address: "1514 Western Ave, Las Vegas, NV",
      hours: "8:00p - 4:00a",
      popularity: { followerCount: 0, directionRequests30d: 1, profileViews30d: 0 },
    },
  ])[0];
  assert.equal(mergedVenue.id, "canonical", "the canonical production record remains authoritative");
  assert.equal(mergedVenue.hours, "8:00p - 4:00a", "missing canonical hours are restored from the duplicate record");
  assert.equal(mergedVenue.popularity.directionRequests30d, 4, "real engagement is retained during deduplication");
  assert.equal(mergedVenue.popularity.profileViews30d, 18, "real profile views are retained during deduplication");
  assert.match(
    homeSource,
    /function publicVenueRecordScore\(venue\)[\s\S]*?venue\?\.slug === canonicalSlug \? 32 : 0[\s\S]*?venue\?\.activeDeal\?\.id/,
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
    /const workingNow = localProfiles[\s\S]*?isWorkingTonight\(profile, city\)[\s\S]*?venueLineupMarkup\(venue, city, \{ mobile: true, profiles: workingNow \}\)[\s\S]*?const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?home-venue-discovery-slide\$\{workingNow\.length \? " has-live-lineup" : ""\}/,
  );
  assert.match(
    homeSource,
    /home-venue-discovery-location[\s\S]*?details\.distanceLabel[\s\S]*?details\.hours[\s\S]*?displayShiftTime\(details\.hours\)[\s\S]*?accessibilityLabel = workingNow\.length/,
  );
  assert.match(
    homeSource,
    /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?venue\?\.id && venue\.activeDeal\?\.id[\s\S]*?data-card-action-slot="qr"[\s\S]*?data-club-deal-state="available"[\s\S]*?data-club-deal-cta[\s\S]*?actionButtonLabel\("qr", offerCount > 1 \? `\$\{offerCount\} Deals` : "Get Deal"\)[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?data-card-qr-label="Club Deal unavailable"[\s\S]*?actionButtonLabel\("qr", "NFC Deal"\)/,
  );
  const venueQrHelper = homeSource.match(
    /function homeVenueDiscoveryQrMarkup\(venue\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
  )?.[0] || "";
  assert.doesNotMatch(
    venueQrHelper,
    /data-external-venue-qr|data-venue-profile-qr|home-venue-discovery-profile-qr/,
  );
  assert.doesNotMatch(homeSource, /publishedVenueQrPass/);
  const venueSlide = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.doesNotMatch(venueSlide, /home-discovery-feed-open-profile/);
  assert.doesNotMatch(venueSlide, /home-discovery-feed-position|\$\{index \+ 1\} \/ \$\{total\}/);
  assert.doesNotMatch(venueSlide, /const upcoming|nextProfile|nextShiftMarkup|No upcoming dancer shifts posted/);
  assert.match(
    venueSlide,
    /homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?home-venue-discovery-name-row[\s\S]*?home-venue-discovery-action-rail[\s\S]*?home-venue-discovery-profile-action[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?actionButtonLabel\("profile", "View Club"\)[\s\S]*?\$\{railQrMarkup\}[\s\S]*?data-share-venue="\$\{venueValue\}"[\s\S]*?data-venue-follow="\$\{venueValue\}"[\s\S]*?home-venue-discovery-context-actions[\s\S]*?\$\{directionsMarkup\}/,
  );
  assert.doesNotMatch(venueSlide, /home-venue-discovery-profile-cta/);
  assert.match(
    venueSlide,
    /home-venue-discovery-lineup-slot[\s\S]*?\$\{lineupMarkup\}/,
  );
  assert.doesNotMatch(
    venueSlide,
    /qrMarkup|dealMarkup|home-venue-discovery-deal|Mydancr venue|home-venue-discovery-identity|MYDANCR VENUE/,
  );
  assert.doesNotMatch(venueSlide, /const accent|--venue-accent/);
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
    /function runVenueShareAction\(venueName, city = selectedCity\(\)\)[\s\S]*?venueShareUrl\(venue, city\)[\s\S]*?navigator\.share\(shareData\)[\s\S]*?copyText\(url, "Club link copied"\)/,
  );
  assert.match(
    homeSource,
    /const venueButton = event\.target\.closest\("\[data-share-venue\]"\)[\s\S]*?runVenueShareAction\([\s\S]*?venueButton\.dataset\.shareVenue/,
  );
  const venueArtRule = homeSource.match(
    /\.home-venue-discovery-art \{[\s\S]*?\n        \}/,
  )?.[0] || "";
  assert.match(venueArtRule, /repeating-linear-gradient\(115deg/);
  assert.match(venueArtRule, /linear-gradient\(145deg, #1d1e22 0%, #090a0c 48%, #131418 100%\)/);
  assert.doesNotMatch(venueArtRule, /--venue-accent|124,58,237/);
  assert.match(
    homeSource,
    /\.home-dancer-grid-action-rail\.home-venue-discovery-action-rail \{[\s\S]*?top: 68px;[\s\S]*?\.home-venue-discovery-context-actions \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-context-actions \.home-discovery-feed-directions \{[\s\S]*?height: 58px;[\s\S]*?min-height: 58px;[\s\S]*?max-height: 58px;[\s\S]*?place-content: center;[\s\S]*?border-color: rgba\(226,232,240,\.28\);[\s\S]*?linear-gradient\(145deg, rgba\(20,21,24,\.96\), rgba\(5,6,8,\.96\)\);[\s\S]*?0 10px 22px rgba\(0,0,0,\.28\);/,
  );
  assert.match(
    homeSource,
    /#results\.home-venue-discovery-feed \.home-venue-discovery-context-actions \.home-discovery-feed-directions \{[\s\S]*?height: 58px !important;[\s\S]*?min-height: 58px !important;[\s\S]*?max-height: 58px !important;[\s\S]*?place-content: center !important;[\s\S]*?border-color: rgba\(226,232,240,\.28\) !important;[\s\S]*?linear-gradient\(145deg,rgba\(20,21,24,\.96\),rgba\(5,6,8,\.96\)\) !important;[\s\S]*?0 10px 22px rgba\(0,0,0,\.28\) !important;/,
  );
  assert.match(
    homeSource,
    /\.home-dancer-grid-action-rail\.home-venue-discovery-action-rail \.feed-card-action \{[\s\S]*?border-color: rgba\(226,232,240,\.2\) !important;[\s\S]*?linear-gradient\(180deg,rgba\(255,255,255,\.065\),transparent 44%\),[\s\S]*?rgba\(7,8,10,\.76\) !important;[\s\S]*?inset 0 1px 0 rgba\(255,255,255,\.07\)/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?linear-gradient\(155deg,#15161a,#050608\) padding-box,[\s\S]*?rgba\(248,250,252,\.38\)[\s\S]*?0 16px 30px rgba\(0,0,0,\.42\) !important;/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-lineup-slot \{[\s\S]*?min-height: 34px;[\s\S]*?\.home-venue-discovery-lineup \{[\s\S]*?padding: 0;[\s\S]*?overflow: visible;[\s\S]*?\.home-venue-discovery-lineup-count \{[\s\S]*?border-radius: 50%;[\s\S]*?font-size: 9px;/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-slide \.home-discovery-feed-copy \{[\s\S]*?bottom: 78px;[\s\S]*?left: 12px;[\s\S]*?padding: 12px;[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?backdrop-filter: none/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-lineup-slot:empty \{[\s\S]*?display: none;[\s\S]*?\.home-venue-discovery-meta:empty \{[\s\S]*?display: none;/,
  );
  const venueActionVisualRule = homeSource.match(
    /\.home-dancer-grid-action-rail\.home-venue-discovery-action-rail \.feed-card-action \{[\s\S]*?\n        \}/,
  )?.[0] || "";
  assert.doesNotMatch(
    venueActionVisualRule,
    /(?:^|\s)(?:width|height|min-height|max-height|padding|margin|position|display|grid|flex|top|right|bottom|left|overflow):/,
  );
});

test("Now grid cards keep production actions while Dancers directory cards link to profiles", () => {
  assert.match(
    homeSource,
    /function homeDancerGridCard\(profile, city, compactDirectory = false\)[\s\S]*?publicProfilePhotoUrl\(profile\)[\s\S]*?class="home-dancer-grid-link" href="\$\{profileHref\}"[\s\S]*?compactDirectory \? "" : homeDancerGridActionsMarkup\(profile, city\)/,
  );
  assert.match(
    homeSource,
    /const photoMarkup = photoUrl[\s\S]*?home-dancer-grid-photo\$\{photoAttrs\.className\}[\s\S]*?aria-hidden="true"[\s\S]*?String\(profile\.name\)\.trim\(\)\.charAt\(0\)/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridActionsMarkup\(profile, city\)[\s\S]*?const profileReference = escapeOptionValue\(profileReferenceValue\(profile\)\)[\s\S]*?data-grid-profile-action="\$\{profileReference\}"[\s\S]*?homeDancerGridQrMarkup\(profile\)[\s\S]*?data-native-share="\$\{profileValue\}"[\s\S]*?data-feed-action="follow"[\s\S]*?data-feed-action="notify"/,
  );
  const dancerGridActions = homeSource.match(
    /function homeDancerGridActionsMarkup\(profile, city\) \{[\s\S]*?(?=\n    function homeDancerGridCard)/,
  )?.[0] || "";
  assert.match(
    dancerGridActions,
    /const profileActionVisual = actionIconMarkup\("profile"\)/,
  );
  assert.doesNotMatch(dancerGridActions, /publicProfilePhotoUrl|customPhotoAttrs|home-dancer-grid-profile-avatar/);
  assert.doesNotMatch(dancerGridActions, /data-profile-qr|home-dancer-grid-profile-qr/);
  assert.match(
    homeSource,
    /function homeDancerGridActionsMarkup\(profile, city\)[\s\S]*?resolveVenueByName\(venueName, city\)[\s\S]*?data-card-venue="\$\{venueValue\}"[\s\S]*?venue-directions-btn[\s\S]*?const goingMarkup = canMarkGoing[\s\S]*?data-feed-action="going"/,
  );
  assert.match(
    homeSource,
    /results\.addEventListener\("click", async \(event\) => \{[\s\S]*?handleQrClick\(event\)[\s\S]*?handleShareClick\(event\)[\s\S]*?data-grid-profile-action[\s\S]*?openProfileModal\(gridProfileButton\.dataset\.gridProfileAction\)[\s\S]*?const card = event\.target\.closest\("\.dancer-card"\);[\s\S]*?openProfileModal\(card\.dataset\.profileReference \|\| card\.dataset\.profile\);/,
  );
  assert.match(
    homeSource,
    /function findProfile\(reference, options = \{\}\)[\s\S]*?String\(item\.id \|\| ""\) === normalizedReference[\s\S]*?String\(item\.slug \|\| ""\) === normalizedReference[\s\S]*?item\.name === normalizedReference/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridCard\(profile, city, compactDirectory = false\)[\s\S]*?data-profile-reference="\$\{profileReference\}"/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid > \.home-dancer-grid-card::before,[\s\S]*?#results\.home-dancer-grid > \.home-dancer-grid-card::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.match(
    homeSource,
    /\.home-dancer-grid-action-rail \{[\s\S]*?position: absolute;[\s\S]*?right: 10px;[\s\S]*?width: 48px;[\s\S]*?grid-template-columns: minmax\(0,1fr\)[\s\S]*?background: transparent !important;[\s\S]*?\.home-dancer-grid-context-actions \{[\s\S]*?repeat\(auto-fit,minmax\(104px,1fr\)\)/,
  );
  assert.match(
    homeSource,
    /\.dancr-button-system \.home-dancer-grid-action-rail \.feed-card-action,[\s\S]*?border: 1px solid rgba\(248,250,252,.18\) !important;[\s\S]*?background: rgba\(8,8,13,.68\) !important;[\s\S]*?-webkit-appearance: none;[\s\S]*?backdrop-filter: blur\(14px\) saturate\(1.08\) !important;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?\.home-dancer-grid-link \{[\s\S]*?position: relative;[\s\S]*?display: block;[\s\S]*?\.home-dancer-grid-copy \{[\s\S]*?position: absolute;[\s\S]*?right: 64px;[\s\S]*?bottom: 58px;[\s\S]*?background: transparent;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?\.home-dancer-grid-context-actions \{[\s\S]*?position: absolute;[\s\S]*?right: 64px;[\s\S]*?bottom: 0;[\s\S]*?background: linear-gradient\(180deg,transparent,rgba\(5,5,8,.94\) 34%\);/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.profile-modal \{[\s\S]*?overflow-y: auto !important[\s\S]*?touch-action: pan-y !important/,
  );
});

test("mobile dancer and venue discovery cards use the same stable viewport footprint", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?height: clamp\(420px, calc\(100svh - 230px\), 540px\) !important;[\s\S]*?min-height: 420px !important;[\s\S]*?max-height: 540px !important;[\s\S]*?border-radius: 20px !important;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?box-sizing: border-box !important;[\s\S]*?width: 100% !important;[\s\S]*?max-width: 100% !important;[\s\S]*?height: clamp\(420px, calc\(100svh - 230px\), 540px\) !important;[\s\S]*?min-height: 420px !important;[\s\S]*?max-height: 540px !important;[\s\S]*?margin: 0 !important;[\s\S]*?padding: 0 !important;[\s\S]*?flex: none !important;[\s\S]*?aspect-ratio: auto !important;[\s\S]*?border-radius: 20px !important;[\s\S]*?contain: layout paint style;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?\.home-dancer-grid-link \{[\s\S]*?height: 100%;[\s\S]*?\.home-dancer-grid-photo \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?height: 100%;[\s\S]*?aspect-ratio: auto;/,
  );
});

test("mobile Dancers and Venues share the same scrollbar-safe results track", () => {
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?#results\.home-dancer-grid,[\s\S]*?#results\.home-discovery-feed\.home-venue-discovery-feed \{[\s\S]*?position: relative !important;[\s\S]*?box-sizing: border-box !important;[\s\S]*?width: 100% !important;[\s\S]*?min-width: 0 !important;[\s\S]*?max-width: none !important;[\s\S]*?margin: 0 !important;[\s\S]*?padding: 0 0 calc\(116px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?overflow: visible !important;[\s\S]*?scroll-padding-bottom: calc\(116px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
});

test("mobile discovery cards use neutral edges while TV is completely borderless", () => {
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?#results\.home-dancer-grid,[\s\S]*?#results\.home-discovery-feed\.home-venue-discovery-feed \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?justify-items: stretch !important;[\s\S]*?#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?width: 100% !important;[\s\S]*?max-width: 100% !important;[\s\S]*?margin: 0 !important;[\s\S]*?justify-self: center !important;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 679px\) \{[\s\S]*?#results \{[\s\S]*?--home-card-edge-neutral: rgba\(248,250,252,.15\);[\s\S]*?--home-card-inner-edge: rgba\(255,255,255,.035\);[\s\S]*?--home-card-drop-shadow: rgba\(0,0,0,.32\);/,
  );
  assert.doesNotMatch(homeSource, /#results\.home-tv-feed \{[\s\S]{0,240}--home-card-(?:edge|inner|glow)/);
  assert.doesNotMatch(
    homeSource,
    /@supports \(-webkit-touch-callout: none\) \{[\s\S]{0,500}--home-card-/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide,[\s\S]*?#results\.card-grid > \.dancer-card\.trending-card,[\s\S]*?#results\.venue-card-grid > \.venue\.venue-card \{[\s\S]*?linear-gradient\(145deg,var\(--home-card-edge-neutral\),var\(--home-card-edge-neutral\)\) border-box !important;[\s\S]*?0 10px 24px var\(--home-card-drop-shadow\) !important;/,
  );
  assert.doesNotMatch(homeSource, /--home-card-glow/);
  assert.match(
    homeSource,
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?background: #000 !important;[\s\S]*?box-shadow: 0 14px 32px rgba\(0,0,0,.38\) !important;/,
  );
  assert.doesNotMatch(homeSource, /--home-card-edge-violet/);
  assert.doesNotMatch(homeSource, /--home-card-edge-cyan/);
  assert.doesNotMatch(homeSource, /--home-card-edge-pink/);
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen > \.home-tv-feed-slide,[\s\S]*?#results\.home-tv-feed:-webkit-full-screen > \.home-tv-feed-slide,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?box-shadow: none !important;/,
  );
  const dancerShellOverride = homeSource.match(
    /#results\.home-dancer-grid > \.home-dancer-grid-card \{\s*border: 1px solid transparent !important;[\s\S]*?\n          \}/,
  )?.[0] || "";
  assert.doesNotMatch(dancerShellOverride, /justify-self: start/);
  assert.doesNotMatch(dancerShellOverride, /width: calc\(100% - 8px\)/);
});

test("Working Now dancer grid cards expose a functional cashier NFC Club Deal action", () => {
  assert.match(
    homeSource,
    /function homeDiscoveryFeedLiveQrData\(profile\) \{\s*if \(!isWorkingTonight\(profile\) \|\| !profile\.venueId\) return null;/,
  );
  assert.match(
    homeSource,
    /function homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?profile\.activeDeal\?\.id[\s\S]*?data-club-deal-cta[\s\S]*?return null;/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridQrMarkup\(profile\)[\s\S]*?dancerClubDealState\(profile\)[\s\S]*?homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?state\.key !== "available"[\s\S]*?class="feed-card-action home-card-qr-rail-action is-unavailable is-\$\{state\.key\}"[\s\S]*?data-card-qr-label[\s\S]*?data-card-qr-message[\s\S]*?actionButtonLabel\("qr", "NFC"\)[\s\S]*?class="feed-card-action home-card-qr-rail-action is-available"[\s\S]*?data-feed-live-qr/,
  );
  assert.match(
    homeSource,
    /results\.addEventListener\("click", async \(event\) => \{[\s\S]*?event\.target\.closest\("\[data-club-deal-cta\], \[data-deal-pass\]"\)[\s\S]*?await handleDealPassClick\(event\);[\s\S]*?return;/,
  );
  assert.match(homeSource, /mydancrPendingNfcDealV1/);
  assert.match(homeSource, /Club Deal ready for cashier NFC/);
  assert.match(homeSource, /Tap the cashier NFC sticker to securely redeem/);
  assert.match(
    homeSource,
    /Shared scrolling-card QR rail shell[\s\S]*?\.home-venue-discovery-action-rail \.home-venue-discovery-rail-qr \{[\s\S]*?width: 48px !important;[\s\S]*?height: 52px !important;[\s\S]*?min-height: 52px !important;[\s\S]*?max-height: 52px !important;[\s\S]*?border-radius: 16px !important;[\s\S]*?opacity: 1 !important;[\s\S]*?\.home-dancer-grid-action-rail \.home-card-qr-rail-action\.is-available[\s\S]*?\.home-dancer-grid-action-rail \.home-card-qr-rail-action\.is-unavailable/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-rail-qr\.is-unavailable \{[\s\S]*?border-color: rgba\(248,250,252,\.2\) !important;[\s\S]*?box-shadow: inset 0 1px 0 rgba\(255,255,255,\.06\),0 7px 18px rgba\(0,0,0,\.28\) !important;[\s\S]*?\.home-venue-discovery-rail-qr\.is-unavailable \.action-icon,[\s\S]*?\.home-venue-discovery-rail-qr\.is-unavailable > span:not\(\.action-icon\) \{[\s\S]*?opacity: \.62;/,
  );
  const dancerQrMarkup = homeSource.match(
    /function homeDancerGridQrMarkup\(profile\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryQrMarkup)/,
  )?.[0] || "";
  assert.match(
    dancerQrMarkup,
    /state\.key === "available-when-working" \? "Unlocks when working" : state\.label/,
  );
  assert.match(dancerQrMarkup, /aria-disabled="true"[\s\S]*?aria-expanded="false"/);
  assert.match(
    homeSource,
    /function showCardQrNotice\(trigger, label, message\)[\s\S]*?closest\("\.home-dancer-grid-card, \.home-venue-discovery-slide, \.home-tv-feed-slide"\)[\s\S]*?triggerCenter[\s\S]*?noticeCenter[\s\S]*?role", "status"[\s\S]*?--home-card-qr-notice-top[\s\S]*?--home-card-qr-notice-right[\s\S]*?aria-expanded", "true"/,
  );
  assert.match(
    homeSource,
    /const unavailableCardQr = event\.target\.closest[\s\S]*?showCardQrNotice\([\s\S]*?unavailableCardQr\.dataset\.cardQrLabel[\s\S]*?unavailableCardQr\.dataset\.cardQrMessage/,
  );
  assert.match(
    homeSource,
    /\.home-card-qr-notice \{[\s\S]*?position: absolute[\s\S]*?right: var\(--home-card-qr-notice-right, 72px\)[\s\S]*?width: min\(280px,[\s\S]*?transform: translate\(8px, -50%\) scale\(\.98\)[\s\S]*?pointer-events: none/,
  );
  assert.doesNotMatch(homeSource, /fetch\("\/api\/deals\/redemptions",\s*\{\s*method:\s*"POST"/);
  assert.doesNotMatch(homeSource, /unavailableCardQr\.title/);
  assert.doesNotMatch(homeSource, /\.home-dancer-grid-qr \{[\s\S]*?position: absolute/);
});

test("dancer grid hierarchy stays readable without changing the production card footprint", () => {
  assert.match(
    homeSource,
    /function homeDancerGridScheduleLabel\(profile, city = selectedCity\(\)\)[\s\S]*?if \(isWorkingTonight\(profile, city\)\) return "Working now";[\s\S]*?if \(!profile\?\.scheduled\) return "No upcoming shift posted";[\s\S]*?month: "short"[\s\S]*?return `Upcoming · \$\{dateLabel\}`/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridCard\(profile, city, compactDirectory = false\)[\s\S]*?const scheduleLabel = homeDancerGridScheduleLabel\(profile, city\);[\s\S]*?home-dancer-grid-status \$\{status\.className\}">\$\{escapeHtml\(scheduleLabel\)\}/,
  );
  assert.match(
    homeSource,
    /const hasPublishedVenue = Boolean\([\s\S]*?profile\.scheduled[\s\S]*?venueName[\s\S]*?venueName\.toLowerCase\(\) !== "venue pending"[\s\S]*?const venueMarkup = hasPublishedVenue/,
  );
  assert.doesNotMatch(homeSource, /home-dancer-grid-venue\$\{venueStateClass\}/);
  assert.match(
    homeSource,
    /const resultCountLabel = activeTab === "venues"[\s\S]*?`\$\{allItems\.length\} club\$\{allItems\.length === 1 \? "" : "s"\}`[\s\S]*?: `\$\{allItems\.length\} total`/,
  );
  assert.match(homeSource, /#homeLiveWorking\.is-empty \{[\s\S]*?rgba\(248, 250, 252, 0\.58\)/);
  assert.match(homeSource, /\.home-dancer-grid-venue span \{[\s\S]*?-webkit-line-clamp: 2;/);
  assert.match(homeSource, /\.home-dancer-grid-name \{[\s\S]*?font-family: var\(--font-ui\);[\s\S]*?font-size: 25px;[\s\S]*?font-weight: 900;/);
  assert.match(homeSource, /height: clamp\(420px, calc\(100svh - 230px\), 540px\) !important;/);
});

test("bottom navigation keeps every destination on one uniform baseline", () => {
  assert.match(
    homeSource,
    /#discoveryTabs \.tab,\s*#discoveryTabs \.home-bottom-tv \{[\s\S]*?height: 65px !important[\s\S]*?grid-template-rows: 36px 16px !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \{[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab-count \{[\s\S]*?top: 2px !important[\s\S]*?left: calc\(50% \+ 27px\) !important[\s\S]*?max-width: none !important[\s\S]*?overflow: visible !important/,
  );
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?width: 36px !important[\s\S]*?height: 36px !important[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
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
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?width: 36px !important[\s\S]*?height: 36px !important[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab,\s*#discoveryTabs \.home-bottom-tv \{[\s\S]*?--home-nav-accent: rgba\(232,230,238,.74\)[\s\S]*?--home-nav-accent-soft: rgba\(232,230,238,.66\)[\s\S]*?--home-nav-active: #f5f3ff[\s\S]*?--home-nav-active-violet-core: rgba\(124,58,237,.96\)[\s\S]*?--home-nav-active-violet-glow: rgba\(124,58,237,.58\)[\s\S]*?--home-nav-active-violet-depth: rgba\(49,46,129,.72\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?color: var\(--home-nav-accent\) !important[\s\S]*?filter: none;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon \{[\s\S]*?border: 0 !important[\s\S]*?border-radius: 0 !important[\s\S]*?color: var\(--home-nav-active\) !important[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important[\s\S]*?filter: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 2px var\(--home-nav-active-violet-core\)\)[\s\S]*?drop-shadow\(0 0 5px var\(--home-nav-active-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 9px var\(--home-nav-active-violet-depth\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-label,[\s\S]*?color: #fff[\s\S]*?text-shadow: 0 1px 2px rgba\(0,0,0,.96\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab-count \{[\s\S]*?border: 0 !important[\s\S]*?color: #fff !important[\s\S]*?background: transparent !important[\s\S]*?text-shadow: 0 1px 2px rgba\(0,0,0,.96\)[\s\S]*?pointer-events: none/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\[data-tab="trending"\] \.tab-count \{[\s\S]*?right: calc\(50% - 25px\) !important[\s\S]*?left: auto !important[\s\S]*?text-align: right/,
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

test("the Dancers grid is profile-first while production action handlers remain wired", () => {
  assert.match(homeSource, /#results\.home-dancer-grid\.home-dancer-three-column \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(homeSource, /function homeDancerGridCard\(profile, city, compactDirectory = false\)[\s\S]*?class="home-dancer-grid-link" href="\$\{profileHref\}"/);
  assert.match(
    homeSource,
    /options\.feedActions[\s\S]*data-feed-action="follow"[\s\S]*data-feed-action="notify"[\s\S]*data-feed-action="going"/,
  );
  assert.match(homeSource, /homeDancerGridSectionMarkup\(section\.label, section\.className, section\.profiles, city, true\)/);
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
    /#tabTitle\.dancers-city-title \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(homeSource, /#tabTitle \.tab-title-city \{[\s\S]*?white-space: nowrap;/);
});

test("the consolidated discovery titles use one typography system and consistent city wording", () => {
  assert.match(
    homeSource,
    /\.content-head h2,[\s\S]*?#tabTitle \{[\s\S]*?font-family: var\(--font-display\) !important;[\s\S]*?font-size: clamp\(24px, 6\.4vw, 30px\) !important;[\s\S]*?font-weight: 800 !important;[\s\S]*?line-height: 1\.02 !important;[\s\S]*?letter-spacing: -0\.01em !important;/,
  );
  assert.match(
    homeSource,
    /dancers: venueFilter === "all" \? `Dancers in \$\{city\}` : `Dancers at \$\{venueFilter\}`,[\s\S]*?venues: `Clubs in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /tabTitle\.textContent = venueFilter \? `MyDancr TV at \$\{venueFilter\.name\}` : `MyDancr TV in \$\{city\}`;/,
  );
  assert.match(
    homeSource,
    /classList\.add\("discovery-section-head", "tv-section-head"\)/,
    "the TV heading must retain the compact discovery layout with a dedicated visual state",
  );
  assert.match(
    aesthetic,
    /\.content-head\.discovery-section-head\.tv-section-head > h2::before \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;[\s\S]*?background: none !important;[\s\S]*?box-shadow: none !important;/,
    "the TV heading must not render the violet side beam",
  );
  const dancerTitleStyle = homeSource.match(/#tabTitle\.dancers-city-title \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.doesNotMatch(dancerTitleStyle, /font-size|font-family|font-weight|line-height|letter-spacing/);
});

test("mobile discovery headings share a compact divided hierarchy across Android and iPhone", () => {
  assert.match(
    homeSource,
    /const usesDiscoverySectionHeader =\s*!selectedVenue && \(activeTab === "dancers" \|\| activeTab === "venues"\);[\s\S]*?classList\.toggle\("discovery-section-head", usesDiscoverySectionHeader\)/,
  );
  assert.match(
    homeSource,
    /\.content-head\.discovery-section-head \{[\s\S]*?padding-bottom: 13px !important;[\s\S]*?border-bottom: 1px solid rgba\(255, 255, 255, \.1\);[\s\S]*?\.content-head\.discovery-section-head \+ #results \{[\s\S]*?margin-top: -7px !important;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?\.content-head\.discovery-section-head \{[\s\S]*?gap: 8px !important;[\s\S]*?margin-top: 4px !important;[\s\S]*?padding: 2px 0 13px !important;[\s\S]*?font-family: var\(--font-ui\) !important;[\s\S]*?font-size: clamp\(22px, 5\.8vw, 27px\) !important;[\s\S]*?font-weight: 900 !important;/,
  );
  assert.match(
    homeSource,
    /\.home-dancer-grid-heading\.is-upcoming strong \{[\s\S]*?color: #b9f6ff;[\s\S]*?text-shadow: none;/,
  );
  assert.match(homeSource, /activeTab === "dancers"[\s\S]*?`\$\{allItems\.length\} total`/);
  assert.match(
    homeSource,
    /function renderHomeTvFeed\(city\)[\s\S]*?classList\.add\("discovery-section-head", "tv-section-head"\)/,
  );
});

test("venue search identifies active venues with an emerald NOW badge", () => {
  assert.match(
    homeSource,
    /id="venueSelect"[\s\S]*?id="venueSelectButton"[\s\S]*?id="venueSelectButtonLive"[^>]*>NOW<[\s\S]*?id="venueSelectDialog"[\s\S]*?id="venueSelectOptions"/,
  );
  assert.match(
    homeSource,
    /function venueWorkingNowCount\(venue, city = selectedCity\(\)\)[\s\S]*?venueDancers\(city, venue\.name\)[\s\S]*?isWorkingTonight\(profile, city\)/,
  );
  assert.match(
    homeSource,
    /data-working-now="\$\{Boolean\(workingNowCount\)\}"[\s\S]*?workingNowCount \? " · NOW"[\s\S]*?venuePickerOptionMarkup\([\s\S]*?workingNowCount/,
  );
  assert.match(
    homeSource,
    /\.venue-picker-trigger-live,[\s\S]*?\.venue-picker-now \{[\s\S]*?color: #10b981[\s\S]*?background: rgba\(16,185,129,\.12\)/,
  );
  assert.match(
    homeSource,
    /function applyVenuePickerSelection\(\)[\s\S]*?venueSelect\.value = pendingVenueSelection[\s\S]*?dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/,
  );
  assert.match(
    homeSource,
    /function closeVenuePicker\(\) \{[\s\S]*?syncVenuePickerSelection\(venueSelect\?\.value \|\| "all"\)/,
  );
});
