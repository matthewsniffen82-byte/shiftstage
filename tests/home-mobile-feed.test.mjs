import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

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
    /bottomTv\.setAttribute\("aria-label", `Show MyDancr TV \$\{tvCityLabel\} videos in the Home feed`\)/,
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
    /@media \(max-width: 720px\) \{[\s\S]*?html\.home-tv-page-snap \{[\s\S]*?scroll-snap-type: y proximity;[\s\S]*?#results\.home-tv-feed \{[\s\S]*?height: auto !important;[\s\S]*?grid-auto-rows: auto;[\s\S]*?overflow: visible !important;[\s\S]*?scroll-snap-type: none;[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?height: clamp\(500px, calc\(100svh - 180px\), 840px\) !important;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: normal;/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?activeTab = nextTab;[\s\S]*?render\(\);[\s\S]*?options\.scroll !== false[\s\S]*?focusHomeResults\(\)/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive|requestHomeDestinationFullscreen|focusAndLockHomeTvFeed/);
  assert.match(
    homeSource,
    /const params = new URLSearchParams\(\{ city, limit: "24" \}\);[^]*?fetch\(`\/api\/public\/tv\?\$\{params\.toString\(\)\}`[^]*?payload\.videos\.filter\(\(item\) => item\?\.id && item\?\.videoUrl && item\?\.dancer\?\.stageName\)/,
  );
  assert.match(
    homeSource,
    /const profileHref = dancerSlug[\s\S]*?`\/\?city=\$\{encodeURIComponent\(dancerCity\)\}&profile=\$\{encodeURIComponent\(dancerSlug\)\}`[\s\S]*?: "#"[\s\S]*?dancer\.href = profileHref/,
  );
  assert.match(
    homeSource,
    /const openDancerProfile = \(event\) => \{[\s\S]*?markets\[dancerCity\]\?\.dancers\.find[\s\S]*?profileItem\.slug === dancerSlug && isApprovedPublicProfile\(profileItem\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?openProfileModal\(profile\.name\)[\s\S]*?dancer\.addEventListener\("click", openDancerProfile\)/,
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

test("all three destinations stay scrollable and loaded TV lands with its title at the viewport start", () => {
  assert.match(
    homeSource,
    /const homeDestinationOrder = \["dancers", "tv", "venues"\];/,
  );
  assert.match(
    homeSource,
    /function alignHomeResultsTitle\(\) \{[\s\S]*?tabTitle\?\.closest\("\.content-head"\)[\s\S]*?scrollIntoView\(\{ block: "start", behavior: "auto" \}\)[\s\S]*?function focusHomeResults\(\) \{[\s\S]*?cancelAnimationFrame\(homeResultsFocusFrame\)[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?alignHomeResultsTitle\(\)/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\)[\s\S]*?activeTab = nextTab;[\s\S]*?homeTvFeedLandingPending = nextTab === "tv" && options\.scroll !== false;[\s\S]*?render\(\);[\s\S]*?options\.scroll !== false && nextTab !== "tv"[\s\S]*?focusHomeResults\(\)/,
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
    /homeTvFeedLandingPending = initialHomeDestinationRequested && initialHomeDestination === "tv";[\s\S]*?render\(\);/,
  );
  assert.match(
    homeSource,
    /\.content-head \{[\s\S]*?scroll-margin-top: calc\(14px \+ env\(safe-area-inset-top\)\)/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?html\.home-tv-page-snap \{[\s\S]*?scroll-snap-type: y proximity;[\s\S]*?scroll-padding-top: calc\(14px \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*?#results\.home-tv-feed \{[\s\S]*?margin: 0 0 calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-snap-type: none;/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive/);
});

test("mobile discovery keeps the active title and destination dock visible while results scroll", () => {
  assert.match(
    homeSource,
    /<div class="content-head discovery-sticky-head">\s*<h2 id="tabTitle">/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?\.app \{\s*overflow: visible !important;[\s\S]*?\.discovery-sticky-head \{[\s\S]*?position: sticky;[\s\S]*?top: calc\(66px \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*?z-index: 70;[\s\S]*?scroll-margin-top: calc\(74px \+ env\(safe-area-inset-top, 0px\)\);/,
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
    /const usesDiscoveryFeed =\s*homeDiscoveryFeedOpen &&\s*activeTab === "venues" &&\s*homeDiscoveryFeedUsesInlineLayout\(\);\s*if \(usesDiscoveryFeed\) \{\s*renderHomeDiscoveryFeed/,
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

test("Dancers uses larger three-column mobile cards with a scrollbar-safe right rail", () => {
  assert.match(
    homeSource,
    /#results\.home-dancer-grid\.home-dancer-three-column \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;[\s\S]*?gap: 10px !important;/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid\.home-dancer-three-column > \.home-dancer-grid-card \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 0 !important;[\s\S]*?max-height: none !important;[\s\S]*?aspect-ratio: 3 \/ 4 !important;/,
  );
  assert.match(
    homeSource,
    /Tight phone spacing enlarges each card[\s\S]*?@media \(max-width: 420px\) \{[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column \{[\s\S]*?width: calc\(100% \+ 16px\) !important;[\s\S]*?margin-inline: -8px !important;[\s\S]*?padding-right: max\(12px, env\(safe-area-inset-right, 0px\)\) !important;[\s\S]*?padding-bottom: calc\(132px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?gap: 4px !important;[\s\S]*?scroll-padding-bottom: calc\(132px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    homeSource,
    /function homeDancerGridCard\(profile, city, compactDirectory = false\)[\s\S]*?class="home-dancer-grid-link" href="\$\{profileHref\}"[\s\S]*?\$\{compactDirectory \? "" : homeDancerGridActionsMarkup\(profile, city\)\}/,
  );
  assert.match(
    homeSource,
    /function renderHomeDancerGrid\(city, profiles\)[\s\S]*?results\.classList\.add\("home-dancer-three-column"\)[\s\S]*?homeDancerGridSectionMarkup\(section\.label, section\.className, section\.profiles, city, true\)/,
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
    /const isVenueFeed = activeTab === "venues";[\s\S]*?classList\.toggle\("home-venue-discovery-feed", isVenueFeed\)[\s\S]*?"venue profiles"[\s\S]*?`Scroll through \$\{discoveryLabel\} in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /if \(!items\.length\)[\s\S]*?No dancers are working now[\s\S]*?No venues match your current filters[\s\S]*?No approved dancer profiles are available/,
  );
  assert.doesNotMatch(homeSource, /No upcoming shifts are posted for tonight|Now and Next appearances/);
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
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?height: clamp\(500px, calc\(100svh - 180px\), 840px\) !important;[\s\S]*?min-height: 500px !important;[\s\S]*?max-height: 840px !important;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: normal;/,
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
    /const workingNow = localProfiles[\s\S]*?isWorkingTonight\(profile, city\)[\s\S]*?const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?const workingNowMarkup = workingNow\.length[\s\S]*?<span class="home-discovery-feed-status is-now">[\s\S]*?: "";/,
  );
  assert.match(
    homeSource,
    /home-venue-discovery-location[\s\S]*?details\.distanceLabel[\s\S]*?details\.hours[\s\S]*?displayShiftTime\(details\.hours\)[\s\S]*?accessibilityLabel = workingNow\.length/,
  );
  assert.match(
    homeSource,
    /function homeVenueDiscoveryQrMarkup\(venue, presentation = "primary"\)[\s\S]*?const rail = presentation === "rail"[\s\S]*?venue\?\.id && venue\.activeDeal\?\.id[\s\S]*?if \(rail\)[\s\S]*?data-card-action-slot="qr"[\s\S]*?home-venue-discovery-club-deal[\s\S]*?Get Club Deal[\s\S]*?data-club-deal-state="unavailable"[\s\S]*?home-venue-discovery-club-deal is-unavailable[\s\S]*?Check back later/,
  );
  const venueQrHelper = homeSource.match(
    /function homeVenueDiscoveryQrMarkup\(venue, presentation = "primary"\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
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
  assert.doesNotMatch(venueSlide, /const upcoming|nextProfile|nextShiftMarkup|No upcoming dancer shifts posted/);
  assert.match(
    venueSlide,
    /homeVenueDiscoveryQrMarkup\(venue, "rail"\)[\s\S]*?home-venue-discovery-action-rail[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?data-share-venue="\$\{venueValue\}"[\s\S]*?data-venue-follow="\$\{venueValue\}"[\s\S]*?home-venue-discovery-context-actions[\s\S]*?\$\{qrMarkup\}[\s\S]*?\$\{directionsMarkup\}/,
  );
  assert.match(
    venueSlide,
    /home-venue-discovery-identity[\s\S]*?home-venue-discovery-identity-mark[\s\S]*?home-venue-discovery-lineup-slot[\s\S]*?\$\{lineupMarkup\}/,
  );
  assert.doesNotMatch(venueSlide, /dealMarkup|home-venue-discovery-deal/);
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
    /function runVenueShareAction\(venueName, city = selectedCity\(\)\)[\s\S]*?venueShareUrl\(venue, city\)[\s\S]*?navigator\.share\(shareData\)[\s\S]*?copyText\(url, "Venue link copied"\)/,
  );
  assert.match(
    homeSource,
    /const venueButton = event\.target\.closest\("\[data-share-venue\]"\)[\s\S]*?runVenueShareAction\([\s\S]*?venueButton\.dataset\.shareVenue/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-art \{[\s\S]*?radial-gradient[\s\S]*?\.home-venue-discovery-deal-action \{[\s\S]*?linear-gradient/,
  );
  assert.match(
    homeSource,
    /\.home-dancer-grid-action-rail\.home-venue-discovery-action-rail \{[\s\S]*?top: 58px;[\s\S]*?\.home-venue-discovery-context-actions \{[\s\S]*?grid-template-columns: minmax\(0, 1\.55fr\) minmax\(0, \.85fr\)/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-club-deal \{[\s\S]*?grid-template-columns: 48px minmax\(0, 1fr\)[\s\S]*?\.home-venue-discovery-club-deal \.home-venue-discovery-qr-symbol \{[\s\S]*?width: 48px;[\s\S]*?\.home-venue-discovery-club-deal-copy strong \{[\s\S]*?font-size: 12px;/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-lineup-slot \{[\s\S]*?min-height: 34px;[\s\S]*?\.home-venue-discovery-lineup strong \{[\s\S]*?color: #fff;[\s\S]*?font-size: 11px;/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-slide \.home-discovery-feed-copy \{[\s\S]*?bottom: 90px;[\s\S]*?left: 12px;[\s\S]*?padding: 12px;[\s\S]*?border-radius: 18px;[\s\S]*?backdrop-filter: blur\(15px\)/,
  );
  assert.match(
    homeSource,
    /\.home-venue-discovery-lineup-slot:empty \{[\s\S]*?display: none;[\s\S]*?\.home-venue-discovery-meta:empty \{[\s\S]*?display: none;/,
  );
  assert.doesNotMatch(
    homeSource,
    /\.home-dancer-grid-action-rail\.home-venue-discovery-action-rail \.feed-card-action \{/,
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
    /function homeDancerGridActionsMarkup\(profile, city\)[\s\S]*?data-grid-profile-action="\$\{profileValue\}"[\s\S]*?homeDancerGridQrMarkup\(profile\)[\s\S]*?data-native-share="\$\{profileValue\}"[\s\S]*?data-feed-action="follow"[\s\S]*?data-feed-action="notify"/,
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
    /results\.addEventListener\("click", async \(event\) => \{[\s\S]*?handleQrClick\(event\)[\s\S]*?handleShareClick\(event\)[\s\S]*?data-grid-profile-action[\s\S]*?openProfileModal\(gridProfileButton\.dataset\.gridProfileAction\)[\s\S]*?const card = event\.target\.closest\("\.dancer-card"\);[\s\S]*?openProfileModal\(card\.dataset\.profile\);/,
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
    /@media \(max-width: 679px\) \{[\s\S]*?#results \{[\s\S]*?--home-card-edge-neutral: rgba\(248,250,252,.15\);[\s\S]*?--home-card-inner-edge: rgba\(255,255,255,.035\);[\s\S]*?--home-card-drop-shadow: rgba\(0,0,0,.38\);[\s\S]*?--home-card-glow: rgba\(91,19,255,.1\);/,
  );
  assert.doesNotMatch(homeSource, /#results\.home-tv-feed \{[\s\S]{0,240}--home-card-(?:edge|inner|glow)/);
  assert.doesNotMatch(
    homeSource,
    /@supports \(-webkit-touch-callout: none\) \{[\s\S]{0,500}--home-card-/,
  );
  assert.match(
    homeSource,
    /#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide,[\s\S]*?#results\.card-grid > \.dancer-card\.trending-card,[\s\S]*?#results\.venue-card-grid > \.venue\.venue-card \{[\s\S]*?linear-gradient\(145deg,var\(--home-card-edge-neutral\),var\(--home-card-edge-neutral\)\) border-box !important;[\s\S]*?0 14px 32px var\(--home-card-drop-shadow\),[\s\S]*?0 0 22px var\(--home-card-glow\) !important;/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?background: #000 !important;[\s\S]*?box-shadow: 0 14px 32px rgba\(0,0,0,.38\) !important;/,
  );
  assert.doesNotMatch(homeSource, /--home-card-edge-violet/);
  assert.doesNotMatch(homeSource, /--home-card-edge-cyan/);
  assert.doesNotMatch(homeSource, /--home-card-edge-pink/);
  assert.match(
    homeSource,
    /#results\.home-tv-feed > \.home-tv-feed-slide:fullscreen,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide:-webkit-full-screen \{[\s\S]*?border: 0 !important;[\s\S]*?box-shadow: none !important;/,
  );
  const dancerShellOverride = homeSource.match(
    /#results\.home-dancer-grid > \.home-dancer-grid-card \{\s*border: 1px solid transparent !important;[\s\S]*?\n          \}/,
  )?.[0] || "";
  assert.doesNotMatch(dancerShellOverride, /justify-self: start/);
  assert.doesNotMatch(dancerShellOverride, /width: calc\(100% - 8px\)/);
});

test("Working Now dancer grid cards expose a functional production Club QR action", () => {
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
    /function homeDancerGridQrMarkup\(profile\)[\s\S]*?dancerClubDealState\(profile\)[\s\S]*?homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?state\.key !== "available"[\s\S]*?class="feed-card-action home-card-qr-rail-action is-unavailable is-\$\{state\.key\}"[\s\S]*?data-card-qr-label[\s\S]*?data-card-qr-message[\s\S]*?actionButtonLabel\("qr", "QR"\)[\s\S]*?class="feed-card-action home-card-qr-rail-action is-available"[\s\S]*?data-feed-live-qr/,
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
    /Shared scrolling-card QR rail state[\s\S]*?\.home-dancer-grid-action-rail \.home-card-qr-rail-action\.is-available[\s\S]*?\.home-dancer-grid-action-rail \.home-card-qr-rail-action\.is-unavailable/,
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
    /function showCardQrNotice\(trigger, label, message\)[\s\S]*?closest\("\.home-dancer-grid-card, \.home-venue-discovery-slide"\)[\s\S]*?role", "status"[\s\S]*?--home-card-qr-notice-top[\s\S]*?--home-card-qr-notice-right[\s\S]*?aria-expanded", "true"/,
  );
  assert.match(
    homeSource,
    /const unavailableCardQr = event\.target\.closest[\s\S]*?showCardQrNotice\([\s\S]*?unavailableCardQr\.dataset\.cardQrLabel[\s\S]*?unavailableCardQr\.dataset\.cardQrMessage/,
  );
  assert.match(
    homeSource,
    /\.home-card-qr-notice \{[\s\S]*?position: absolute[\s\S]*?right: var\(--home-card-qr-notice-right, 72px\)[\s\S]*?pointer-events: none/,
  );
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
    /const resultCountLabel = activeTab === "venues"[\s\S]*?`\$\{allItems\.length\} venue\$\{allItems\.length === 1 \? "" : "s"\}`[\s\S]*?: `\$\{allItems\.length\} total`/,
  );
  assert.match(homeSource, /#homeLiveWorking\.is-empty \{[\s\S]*?rgba\(248, 250, 252, 0\.58\)/);
  assert.match(homeSource, /\.home-dancer-grid-venue span \{[\s\S]*?-webkit-line-clamp: 2;/);
  assert.match(homeSource, /\.home-dancer-grid-name \{[\s\S]*?font-family: var\(--font-ui\);[\s\S]*?font-size: 25px;[\s\S]*?font-weight: 900;/);
  assert.match(homeSource, /height: clamp\(420px, calc\(100svh - 230px\), 540px\) !important;/);
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
    /#discoveryTabs \.tab,\s*#discoveryTabs \.home-bottom-tv \{[\s\S]*?--home-nav-accent: rgba\(232,230,238,.74\)[\s\S]*?--home-nav-accent-soft: rgba\(232,230,238,.66\)[\s\S]*?--home-nav-active: #fff[\s\S]*?--home-nav-active-violet-core: rgba\(152,95,255,.98\)[\s\S]*?--home-nav-active-violet-glow: rgba\(91,19,255,1\)[\s\S]*?--home-nav-active-cyan-glow: rgba\(52,110,255,.58\)/,
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
    /#discoveryTabs \.tab\.active \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 2px var\(--home-nav-active-violet-core\)\)[\s\S]*?drop-shadow\(0 0 6px var\(--home-nav-active-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 12px var\(--home-nav-active-cyan-glow\)\)/,
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
    /dancers: venueFilter === "all" \? `Dancers in \$\{city\}` : `Dancers at \$\{venueFilter\}`,[\s\S]*?venues: `Venues in \$\{city\}`/,
  );
  assert.match(homeSource, /tabTitle\.textContent = `MyDancr TV in \$\{city\}`;/);
  const dancerTitleStyle = homeSource.match(/#tabTitle\.dancers-city-title \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.doesNotMatch(dancerTitleStyle, /font-size|font-family|font-weight|line-height|letter-spacing/);
});

test("the mobile dancer heading is compact and consistent across Android and iPhone", () => {
  assert.match(
    homeSource,
    /tabTitle\.closest\("\.content-head"\)\?\.classList\.toggle\("dancers-directory-head", keepDancerCityOnOneLine\)/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?\.content-head\.dancers-directory-head \{[\s\S]*?gap: 6px !important;[\s\S]*?margin-top: 4px !important;[\s\S]*?padding: 2px 0 0 !important;[\s\S]*?font-size: clamp\(22px, 5\.8vw, 27px\) !important;[\s\S]*?\.content-head\.dancers-directory-head \+ #results\.home-dancer-grid \{[\s\S]*?margin-top: -6px !important;/,
  );
  assert.match(
    homeSource,
    /\.home-dancer-grid-heading\.is-upcoming strong \{[\s\S]*?color: #b9f6ff;[\s\S]*?text-shadow: none;/,
  );
  assert.match(homeSource, /activeTab === "dancers"[\s\S]*?`\$\{allItems\.length\} total`/);
  assert.match(
    homeSource,
    /function renderHomeTvFeed\(city\)[\s\S]*?classList\.remove\("dancers-directory-head"\)/,
  );
});
