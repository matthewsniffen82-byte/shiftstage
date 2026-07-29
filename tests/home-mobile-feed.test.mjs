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
  assert.match(navigation, /id="homeBottomTv"[^>]*aria-controls="results"[^>]*aria-current="false"/);
  assert.doesNotMatch(navigation, /id="homeBottomTv"[^>]*href=/);
  assert.match(homeSource, /#discoveryTabs \{[\s\S]*position: fixed !important[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(homeSource, /\.home-bottom-tv-icon \{[\s\S]*linear-gradient\(135deg,#7c3aed,#ec4899\)/);
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
    /homeBottomTv\?\.addEventListener\("click"[\s\S]*?activeTab = "tv"[\s\S]*?render\(\)[\s\S]*?focusAndLockHomeTvFeed/,
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
  assert.match(homeSource, /venue\.href = `\/venues\/\$\{encodeURIComponent\(venueSlug\)\}`/);
  assert.match(homeSource, /"Working now"[\s\S]*?`Upcoming \$\{formatProfileTvShift/);
  assert.match(
    homeSource,
    /new IntersectionObserver\([\s\S]*?activateHomeTvFeedVideo/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedCloseButton\(\)[\s\S]*?close\.className = "home-tv-feed-close"[\s\S]*?close\.setAttribute\("aria-label", "Close MyDancr TV"\)[\s\S]*?close\.addEventListener\("click", closeHomeTvFeed\)/,
  );
  assert.match(
    homeSource,
    /results\.replaceChildren\(\s*createHomeTvFeedCloseButton\(\),[\s\S]*?createHomeTvFeedSlide\(item, index, homeTvFeedVideos\.length\)/,
  );
  assert.match(
    homeSource,
    /function renderHomeTvFeedLoading\(\) \{[\s\S]*?loading\.className = "home-tv-feed-loading"[\s\S]*?loading\.setAttribute\("role", "status"\)[\s\S]*?loading\.setAttribute\("aria-label", "Loading MyDancr TV"\)[\s\S]*?results\.replaceChildren\(createHomeTvFeedCloseButton\(\), loading\)/,
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
    /#discoveryTabs \.tab-count \{[\s\S]*?top: 0 !important[\s\S]*?left: calc\(50% \+ 16px\) !important[\s\S]*?max-width: 27px !important[\s\S]*?height: 17px !important/,
  );
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?width: 30px !important[\s\S]*?height: 30px !important[\s\S]*?margin: 0 !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab::before,[\s\S]*?#discoveryTabs \.home-bottom-tv::after \{[\s\S]*?content: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?width: 30px !important[\s\S]*?height: 30px !important[\s\S]*?background: rgba\(28,27,36,.96\)/,
  );
});

test("mobile legal actions form a complete equal two-row grid above navigation", () => {
  assert.match(
    homeSource,
    /main\.stack > \.legal-links \{[\s\S]*?display: grid !important[\s\S]*?grid-template-columns: repeat\(3,minmax\(0,1fr\)\) !important/,
  );
  assert.match(
    homeSource,
    /main\.stack > \.legal-links \.legal-link \{[\s\S]*?width: 100% !important[\s\S]*?min-height: 44px !important[\s\S]*?margin: 0 !important/,
  );
  assert.match(
    homeSource,
    /main\.stack > \.legal-links \.admin-legal-link \{[\s\S]*?grid-column: auto !important[\s\S]*?justify-self: stretch !important[\s\S]*?margin: 0 !important/,
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
