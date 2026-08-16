import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, tvSource, applauseMigration, aestheticSource, fullTvFeedSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../supabase/migrations/202607300003_mydancr_tv_applause_events.sql", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
]);

test("the homepage TV card uses a resilient, readable media-first presentation", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-video \{[\s\S]*?object-fit: cover[\s\S]*?\.home-tv-feed-media-fallback \{[\s\S]*?background: var\(--dancr-color-background, #050507\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-shade \{[\s\S]*?rgba\(0,0,0,.98\) 100%/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-dancer \{[\s\S]*?min-height: 52px;[\s\S]*?grid-template-columns: 52px minmax\(0, 1fr\)[\s\S]*?gap: 10px;[\s\S]*?font-size: clamp\(22px, 5\.4vw, 28px\);[\s\S]*?\.home-tv-feed-dancer-photo \{[\s\S]*?width: 52px;[\s\S]*?height: 52px;[\s\S]*?border-radius: 999px;[\s\S]*?\.home-tv-feed-dancer-photo img \{[\s\S]*?object-fit: cover;[\s\S]*?\.home-tv-feed-dancer-copy \{[\s\S]*?gap: 3px;[\s\S]*?\.home-tv-feed-dancer-name \{[\s\S]*?overflow-wrap: anywhere/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-meta \{[\s\S]*?width: 100%;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-verified \{[\s\S]*?width: 18px[\s\S]*?height: 18px/,
  );
  assert.match(
    homeSource,
    /meta\.textContent = dancerCity[\s\S]*?dancerCopy\.append\(nameRow, meta\)[\s\S]*?dancer\.append\(dancerPhoto, dancerCopy\)/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-context \{[\s\S]*?width: 100%;[\s\S]*?display: grid;[\s\S]*?margin-left: 0;[\s\S]*?overflow: visible;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-venue span \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?text-overflow: clip;[\s\S]*?white-space: normal;/,
  );
  assert.doesNotMatch(
    homeSource.match(/\.home-tv-feed-dancer-name \{[\s\S]*?\}/)?.[0] || "",
    /text-overflow: ellipsis|white-space: nowrap/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-profile-hint|home-tv-feed-profile-cue|View profile →/);
  assert.match(
    homeSource,
    /actions\.className = "home-tv-feed-actions"[\s\S]*?follow\.className = `home-tv-feed-action home-tv-feed-follow-action feed-card-action[\s\S]*?follow\.dataset\.feedAction = "follow"[\s\S]*?follow\.dataset\.profile = dancerName[\s\S]*?follow\.dataset\.homeTvVideoId = videoId[\s\S]*?follow\.dataset\.iconOnlyAction = "true"[\s\S]*?follow\.innerHTML = actionIconMarkup\(isFollowed \? "check" : "heart"\)/,
  );
  assert.doesNotMatch(homeSource, /home-tv-feed-dancer-actions/);
  assert.match(
    homeSource,
    /profile\.className = "home-tv-feed-action home-tv-feed-profile-action"|"home-tv-feed-profile-action",[\s\S]*?actionIconMarkup\("profile"\)/,
  );
  assert.match(
    homeSource,
    /const dancerPhotoUrl = String\(item\?\.dancer\?\.avatarPhotoUrl \|\| item\?\.dancer\?\.primaryPhotoUrl[\s\S]*?dancerPhoto\.className = "home-tv-feed-dancer-photo"[\s\S]*?dancerPhotoImage\.src = dancerPhotoUrl[\s\S]*?dancerPhotoImage\.addEventListener\("error", \(\) => dancerPhotoImage\.remove\(\)\)[\s\S]*?dancer\.append\(dancerPhoto, dancerCopy\)/,
  );
  assert.match(
    homeSource,
    /function homeTvFeedDealState\(item\)[\s\S]*?item\?\.venue\?\.id[\s\S]*?item\?\.deal\?\.id[\s\S]*?item\?\.dealAttributionToken[\s\S]*?home-tv-feed-deal-action home-card-qr-rail-action[\s\S]*?deal\.dataset\.clubDealCta = encodeDealPass[\s\S]*?sourceType: "dancer_profile"[\s\S]*?deal\.dataset\.feedLiveQr = "true"/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-deal-action \{[\s\S]*?border-color: var\(--dancr-color-success-strong\)[\s\S]*?var\(--dancr-color-success\)/,
  );
  const mediaFallbackFactory = homeSource.match(
    /function createHomeTvFeedMediaFallback\(\) \{[\s\S]*?return fallback;\s*\}/,
  )?.[0] || "";
  const videoFactory = homeSource.match(
    /function createHomeTvFeedVideo\(item, index, slide, totalVideos\) \{[\s\S]*?(?=\n    function createHomeTvFeedCopy)/,
  )?.[0] || "";
  assert.doesNotMatch(mediaFallbackFactory, /primaryPhotoUrl|backgroundImage|url\(/);
  assert.doesNotMatch(videoFactory, /primaryPhotoUrl|\.poster\s*=/);
  assert.match(mediaFallbackFactory, /status\.hidden = true/);
  assert.doesNotMatch(mediaFallbackFactory, /Loading video/);
  assert.match(videoFactory, /video\.addEventListener\("loadeddata"[\s\S]*?classList\.remove\("is-media-loading", "is-media-unavailable"\)/);
  assert.match(videoFactory, /video\.addEventListener\("error"[\s\S]*?"Video unavailable"/);
  assert.match(
    homeSource,
    /function primeHomeTvFeedNeighbors\(videoId\)[\s\S]*?Math\.abs\(index - activeIndex\) <= 1[\s\S]*?video\.preload = shouldWarm \? "auto" : "none"[\s\S]*?video\.load\(\)/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedProgress\(\)[\s\S]*?role", "progressbar"/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedProgress\(video, slide\)[\s\S]*?aria-valuenow/,
  );
});

test("TV cards expose separate right-side actions and one unified playback dock", () => {
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";
  const renderFactory = homeSource.match(
    /function renderHomeTvFeedSlide\(slide, item, videoIndex, totalVideos\) \{[\s\S]*?(?=\n    function createHomeTvFeedSlide)/,
  )?.[0] || "";

  assert.match(actionsFactory, /createHomeTvFeedActionButton\([\s\S]*?"home-tv-feed-profile-action"[\s\S]*?actionIconMarkup\("profile"\)[\s\S]*?slide\.querySelector\("\.home-tv-feed-dancer"\)\?\.click\(\)[\s\S]*?"Share"[\s\S]*?follow\.dataset\.feedAction = "follow"[\s\S]*?createHomeTvFeedActionButton\([\s\S]*?"Report"/);
  assert.match(actionsFactory, /actions\.append\(profile\)[\s\S]*?actions\.appendChild\(deal\)[\s\S]*?actions\.append\(share, follow\)[\s\S]*?actions\.append\(report, reportMenu\)/);
  assert.doesNotMatch(actionsFactory, /actionIconMarkup\("star"\)|"Applaud"/);
  assert.doesNotMatch(actionsFactory, /More video actions|home-tv-feed-action-menu|home-tv-feed-menu-action/);
  assert.match(actionsFactory, /event\.key !== "Escape"[\s\S]*?closeHomeTvFeedReportMenus\(\)/);
  assert.match(homeSource, /results\.addEventListener\("click", async \(event\) => \{\s*if \(!event\.target\.closest\("\.home-tv-feed-actions"\)\) closeHomeTvFeedReportMenus\(\)/);
  assert.match(renderFactory, /playback,[\s\S]*?createHomeTvFeedActions\(item, slide\),[\s\S]*?createHomeTvFeedCopy[\s\S]*?createHomeTvFeedProgress\(\),[\s\S]*?createHomeTvFeedVideoControls\(slide, video\)/);
  assert.match(homeSource, /\.home-tv-feed-actions \{[\s\S]*?right: 12px;[\s\S]*?bottom: 76px;[\s\S]*?display: grid;[\s\S]*?justify-items: end;[\s\S]*?gap: 8px;/);
  assert.match(homeSource, /\.home-tv-feed-video-controls \{[\s\S]*?position: absolute;[\s\S]*?right: 12px;[\s\S]*?bottom: 11px;[\s\S]*?left: 12px;/);
  assert.match(homeSource, /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?background: #000 !important;/);
});

test("TV cards retain a neutral NFC placeholder until a verified live Club Deal is available", () => {
  const dealStateFactory = homeSource.match(
    /function homeTvFeedDealState\(item\) \{[\s\S]*?(?=\n    function closeHomeTvFeedReportMenus)/,
  )?.[0] || "";
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";

  assert.match(dealStateFactory, /key: "available"[\s\S]*?key: "no-active-offer"[\s\S]*?key: "available-when-working"[\s\S]*?key: "not-available-now"/);
  assert.match(actionsFactory, /deal\.dataset\.cardActionSlot = "qr"/);
  assert.match(actionsFactory, /deal\.dataset\.cardQrLabel = dealState\.label[\s\S]*?deal\.dataset\.cardQrMessage = dealState\.detail/);
  assert.match(actionsFactory, /aria-disabled", "true"[\s\S]*?aria-expanded", "false"/);
  assert.match(actionsFactory, /home-tv-feed-deal-count">Deals/);
  assert.doesNotMatch(actionsFactory, /home-tv-feed-deal-count">NFC/);
  assert.match(homeSource, /\.home-tv-feed-deal-action\.is-unavailable,[\s\S]*?background: rgba\(18,15,28,\.72\)[\s\S]*?cursor: pointer;/);
  assert.match(fullTvFeedSource, /<TvClubDealUnavailable video=\{video\} \/>/);
  assert.match(fullTvFeedSource, /function TvClubDealUnavailable[\s\S]*?No Club Deal available[\s\S]*?Unlocks when working[\s\S]*?Not available now/);
  assert.match(fullTvFeedSource, /className="tv-club-deal-unavailable"[\s\S]*?<NfcIcon \/>[\s\S]*?<small>Club Deals<\/small>/);
});

test("TV Club Deal states keep one fixed rounded-square shape", () => {
  const dealShell = homeSource.match(
    /\.home-tv-feed-deal-action \{[\s\S]*?\n        \}/,
  )?.[0] || "";
  const dealLabel = homeSource.match(
    /\.home-tv-feed-deal-count \{[\s\S]*?\n        \}/,
  )?.[0] || "";
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";

  assert.match(dealShell, /box-sizing: border-box !important;/);
  assert.match(dealShell, /width: 52px !important;[\s\S]*?min-width: 52px !important;[\s\S]*?max-width: 52px !important;/);
  assert.match(dealShell, /height: 52px !important;[\s\S]*?min-height: 52px !important;[\s\S]*?max-height: 52px !important;/);
  assert.match(dealShell, /padding: 5px 3px !important;[\s\S]*?border-radius: 16px !important;[\s\S]*?overflow: hidden !important;/);
  assert.match(dealLabel, /position: static;[\s\S]*?width: 100%;[\s\S]*?background: transparent;/);
  assert.equal((actionsFactory.match(/home-tv-feed-deal-count">Deals/g) || []).length, 2);
});

test("TV Club Deal branding cannot change the shell between active and inactive states", () => {
  const stateStyles = aestheticSource.match(
    /\/\* TV Club Deal controls share one fixed shell[\s\S]*?(?=\/\* Production venue-detail branding)/,
  )?.[0] || "";

  assert.match(stateStyles, /\.home-tv-feed-deal-action\.is-available \{[\s\S]*?var\(--dancr-color-success-strong\)/);
  assert.match(stateStyles, /\.home-tv-feed-deal-action\.is-unavailable,[\s\S]*?border-color: rgba\(148, 163, 184, 0\.42\) !important;[\s\S]*?background: rgba\(17, 17, 24, 0\.92\) !important;/);
  assert.doesNotMatch(stateStyles, /\.home-tv-feed-deal-action \{|\b(?:width|height|padding|margin|position|inset|display|grid|flex|gap|overflow|transform):/);
});

test("TV cards are completely borderless without a violet perimeter", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-loading \{[\s\S]*?border: 0;/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?background: #000 !important;[\s\S]*?box-shadow: 0 14px 32px rgba\(0,0,0,\.38\) !important;/,
  );
  const tvSlideShell = homeSource.match(/\.home-tv-feed-slide \{[\s\S]*?contain: layout paint style;[\s\S]*?\}/)?.[0] || "";
  assert.match(tvSlideShell, /border: 0;/);
  assert.match(tvSlideShell, /box-shadow: 0 20px 54px rgba\(0,0,0,\.48\);/);
  assert.doesNotMatch(tvSlideShell, /139,92,246|124,58,237|91,19,255|violet/);
  const sharedMobileCardShell = homeSource.match(
    /#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.venue-card-grid > \.venue\.venue-card \{[\s\S]*?0 0 22px var\(--home-card-glow\) !important;[\s\S]*?\}/,
  )?.[0] || "";
  assert.doesNotMatch(sharedMobileCardShell, /home-tv-feed/);
  assert.doesNotMatch(
    homeSource.match(/\.home-tv-feed-loading \{[\s\S]*?\}/)?.[0] || "",
    /139,92,246|124,58,237|violet/,
  );
  assert.match(
    aestheticSource,
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?outline: 0 !important;[\s\S]*?background: #000 !important;[\s\S]*?box-shadow: 0 14px 32px rgba\(0, 0, 0, 0\.38\) !important;/,
  );
  const homepageTvMediaOverride = aestheticSource.match(
    /\/\* The feed video intentionally exposes role="button"[\s\S]*?(?=\r?\n\r?\nbody > \.app main\.stack > #results \.home-venue-discovery-art)/,
  )?.[0] || "";
  assert.match(homepageTvMediaOverride, /> video\.home-tv-feed-video \{/);
  assert.match(homepageTvMediaOverride, /border: 0 !important;/);
  assert.match(homepageTvMediaOverride, /border-radius: 0 !important;/);
  assert.match(homepageTvMediaOverride, /outline: 0 !important;/);
  assert.match(homepageTvMediaOverride, /background: #000 !important;/);
  assert.match(homepageTvMediaOverride, /background-image: none !important;/);
  assert.match(homepageTvMediaOverride, /box-shadow: none !important;/);
  assert.match(homepageTvMediaOverride, /filter: none !important;/);
  assert.match(homepageTvMediaOverride, /> video\.home-tv-feed-video:focus-visible/);
  assert.match(homepageTvMediaOverride, /outline: 2px solid var\(--dancr-color-info\) !important;/);
  assert.doesNotMatch(homepageTvMediaOverride, /beam-violet|brand-primary|109, 40, 217/);
  const sharedAestheticCardShell = aestheticSource.match(
    /#results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.venue-card-grid > \.venue-card \{[\s\S]*?filter: none !important;[\s\S]*?\}/,
  )?.[0] || "";
  assert.doesNotMatch(sharedAestheticCardShell, /home-tv-feed/);
  const sharedAestheticSurfaceShell = aestheticSource.match(
    /body > \.app main\.stack > #results :is\([\s\S]*?\.home-discovery-feed-slide[\s\S]*?\) \{[\s\S]*?inset 0 1px 0 var\(--dancr-color-white-soft\) !important;[\s\S]*?\}/,
  )?.[0] || "";
  assert.doesNotMatch(sharedAestheticSurfaceShell, /home-tv-feed/);
  const fullTvPlayerRule = fullTvFeedSource.match(
    /\.tv-player \{[\s\S]*?filter: none; \}/,
  )?.[0] || "";
  assert.match(fullTvPlayerRule, /border: 0;/);
  assert.match(fullTvPlayerRule, /outline: 0;/);
  assert.match(fullTvPlayerRule, /background: #000;/);
  assert.doesNotMatch(fullTvPlayerRule, /139,92,246|124,58,237|109,40,217|violet/);
  const fullTvPerimeterOverride = aestheticSource.match(
    /\/\* Full-page TV cards stay perimeter-free[\s\S]*?(?=\r?\n\r?\n\.public-profile-shell)/,
  )?.[0] || "";
  assert.match(fullTvPerimeterOverride, /\.tv-player:focus-within/);
  assert.match(fullTvPerimeterOverride, /\.tv-slide:is\(\.is-active, \[aria-current="true"\]\) \.tv-player/);
  assert.match(fullTvPerimeterOverride, /border: 0 !important;/);
  assert.match(fullTvPerimeterOverride, /outline: 0 !important;/);
  assert.match(fullTvPerimeterOverride, /background: #000 !important;/);
  assert.match(fullTvPerimeterOverride, /\.tv-player video:focus-visible/);
  assert.match(fullTvPerimeterOverride, /outline: 2px solid var\(--dancr-color-info\) !important;/);
  assert.match(fullTvPerimeterOverride, /outline-offset: -4px !important;/);
  assert.doesNotMatch(fullTvPerimeterOverride, /beam-violet|brand-primary|109, 40, 217/);
  const sharedFullTvSurfaceRule = aestheticSource.match(
    /\.tv-shell :is\(\.tv-header, \.tv-empty, \.tv-status, \.tv-loading\) \{[\s\S]*?\r?\n\}/,
  )?.[0] || "";
  assert.doesNotMatch(sharedFullTvSurfaceRule, /\.tv-player/);
  const sharedVioletFocusRule = aestheticSource.match(
    /\.public-profile-shell :is\(\r?\n  \.public-profile-close,[\s\S]*?\):focus-visible,\r?\n\.tv-shell :is\([\s\S]*?box-shadow: var\(--dancr-focus-ring\) !important;\r?\n\}/,
  )?.[0] || "";
  assert.doesNotMatch(sharedVioletFocusRule, /\.tv-player video/);
});

test("mobile TV controls stay inside the stable card that snaps above navigation", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-copy \{[\s\S]*?padding: 82px 0 28px 14px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-actions \{[\s\S]*?bottom: 76px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-video-controls \{[\s\S]*?bottom: 11px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-progress \{[\s\S]*?height: 3px;[\s\S]*?background: color-mix\(in srgb, var\(--dancr-color-text-primary\) 58%, transparent\);[\s\S]*?box-shadow: 0 1px 5px var\(--dancr-color-black-strong\);[\s\S]*?\.home-tv-feed-progress > span \{[\s\S]*?background: color-mix\(in srgb, var\(--dancr-color-text-primary\) 88%, transparent\);[\s\S]*?box-shadow: none;/,
  );
  assert.doesNotMatch(
    homeSource.match(/\.home-tv-feed-progress > span \{[\s\S]*?\}/)?.[0] || "",
    /#a855f7|#22d3ee|linear-gradient/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.doesNotMatch(homeSource, /\.home-tv-feed-position|position\.textContent = `Video/);
  assert.match(homeSource, /\.home-tv-feed-video-controls \{[\s\S]*?grid-template-columns: 36px 36px minmax\(74px, 1fr\) 64px 36px;/);
});

test("empty schedules are hidden while real city, venue, and shift context remains", () => {
  const scheduleFunction =
    homeSource.match(
      /function homeTvFeedSchedule\(item\) \{[\s\S]*?(?=\n    function createHomeTvFeedMediaFallback)/,
    )?.[0] || "";
  assert.match(scheduleFunction, /"Working Now"/);
  assert.match(scheduleFunction, /dateLabel \? `Upcoming · \$\{dateLabel\}` : "Upcoming"/);
  assert.match(scheduleFunction, /return null/);
  assert.doesNotMatch(scheduleFunction, /No shift posted/);
  const shiftDateFormatter = homeSource.match(
    /function formatProfileTvShift\(startsAt, timeZone\) \{[\s\S]*?(?=\n    function clearProfileDeepLink)/,
  )?.[0] || "";
  assert.match(shiftDateFormatter, /weekday: "short"[\s\S]*?month: "short"[\s\S]*?day: "numeric"/);
  assert.doesNotMatch(shiftDateFormatter, /hour:|minute:|toLocaleTimeString|formatClock/);
  assert.match(
    homeSource,
    /if \(scheduleContext\)[\s\S]*?context\.className = "home-tv-feed-context"[\s\S]*?context\.appendChild\(schedule\)[\s\S]*?if \(venueName\)[\s\S]*?venue\.className = "home-tv-feed-venue"[\s\S]*?context\.appendChild\(venue\)[\s\S]*?copy\.appendChild\(context\)/,
  );
});

test("every uploaded video gets a vertically scrollable card with profile access, applause gestures, sharing, and reporting", () => {
  assert.match(
    homeSource,
    /results\.replaceChildren\(\s*\.\.\.homeTvFeedVideos\.map\(\(item, index\) => \(\s*createHomeTvFeedSlide\(item, index, homeTvFeedVideos\.length\)/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedSlide\(item, index, total\)[\s\S]*?renderHomeTvFeedSlide\(slide, item, index, total\)/,
  );
  assert.match(
    homeSource,
    /slide\.setAttribute\([\s\S]*?"aria-label",[\s\S]*?MyDancr TV video \$\{videoIndex \+ 1\} of \$\{totalVideos\}/,
  );
  assert.doesNotMatch(homeSource, /groupHomeTvFeedVideos|setupHomeTvFeedMediaGestures|showHomeTvFeedMedia/);
  assert.match(
    homeSource,
    /tapAt - lastTapAt <= 320[\s\S]*?applaudHomeTvFeedVideo\(item, slide\)/,
  );
  assert.match(
    homeSource,
    /async function shareHomeTvFeedVideo\(item, slide, button\)[\s\S]*?`\/tv\/\$\{encodeURIComponent\(videoId\)\}`[\s\S]*?navigator\.share[\s\S]*?copyText\(url, "Video link copied"\)[\s\S]*?"share"/,
  );
  assert.match(
    homeSource,
    /async function reportHomeTvFeedVideo\(item, reason, slide, button\)[\s\S]*?fetch\("\/api\/reports"[\s\S]*?targetType: "tv_video"[\s\S]*?targetId: videoId[\s\S]*?"report"/,
  );
  assert.match(homeSource, /Sexual or unsafe content[\s\S]*?Other safety concern/);
  assert.doesNotMatch(
    homeSource.match(
      /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
    )?.[0] || "",
    /save|bookmark/i,
  );
});

test("applause is recorded through the constrained production TV analytics path", () => {
  assert.match(tvSource, /MYDANCR_TV_EVENT_TYPES = new Set\(\[[\s\S]*?"applause"/);
  assert.match(tvSource, /function emptyMetrics\(\)[\s\S]*?applause: 0/);
  assert.match(
    applauseMigration,
    /drop constraint if exists mydancr_tv_event_type_check[\s\S]*?event_type in \([\s\S]*?'applause'/,
  );
  assert.match(
    homeSource,
    /if \(following && actionButton\.dataset\.homeTvVideoId\)[\s\S]*?trackHomeTvFeedEvent\(actionButton\.dataset\.homeTvVideoId, "follow"\)/,
  );
});

test("card controls expose accessible labels, keyboard alternatives, and feedback", () => {
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive/);
  const controlsFactory =
    homeSource.match(
      /function createHomeTvFeedVideoControls\(slide, video\) \{[\s\S]*?(?=\n    function renderHomeTvFeedSlide)/,
    )?.[0] || "";
  assert.match(
    controlsFactory,
    /aria-label", "Video playback controls"[\s\S]*?home-tv-feed-video-play[\s\S]*?createHomeTvFeedSoundButton\(slide\)[\s\S]*?type = "range"[\s\S]*?home-tv-feed-video-time[\s\S]*?createHomeTvFeedFullscreenButton\(slide, video\)/,
  );
  assert.match(
    controlsFactory,
    /range\.addEventListener\("input"[\s\S]*?video\.currentTime = Math\.min[\s\S]*?syncHomeTvFeedControls\(video, slide\)/,
  );
  assert.match(homeSource, /function syncHomeTvFeedControls\(video, slide\)[\s\S]*?formatProfileTvDuration\(currentTime\)[\s\S]*?formatProfileTvDuration\(duration\)/);
  assert.match(homeSource, /function showHomeTvFeedControls\(slide,[\s\S]*?is-controls-visible[\s\S]*?2200/);
  assert.match(homeSource, /function syncHomeTvFeedFullscreenState\(\)[\s\S]*?alignHomeTvFeedFullscreenSlide\(activeSlide\)[\s\S]*?showHomeTvFeedControls\(activeSlide\)/);
  assert.match(
    homeSource,
    /Tap to show playback controls, double tap to applaud[\s\S]*?scroll up or down for another video[\s\S]*?event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"[\s\S]*?event\.key === "a" \|\| event\.key === "A"/,
  );
  assert.match(
    homeSource,
    /feedback\.setAttribute\("role", "status"\)[\s\S]*?feedback\.setAttribute\("aria-live", "polite"\)/,
  );
  assert.match(
    homeSource,
    /function showHomeTvFeedFeedback\(slide, message, tone = "default"\)[\s\S]*?feedback\.classList\.toggle\("is-neutral", tone === "neutral"\)[\s\S]*?feedback\.classList\.remove\("show", "is-neutral"\)/,
  );
  assert.match(
    homeSource,
    /reportMenu\.setAttribute\("role", "menu"\)[\s\S]*?option\.setAttribute\("role", "menuitem"\)/,
  );
  assert.match(
    homeSource,
    /video\.controlsList = "nodownload noremoteplayback nofullscreen"[\s\S]*?video\.disablePictureInPicture = true/,
  );
});

test("intentional pauses persist while fullscreen resumes playback and keeps vertical snap scrolling", () => {
  assert.match(
    homeSource,
    /function toggleHomeTvFeedPlayback\(video\)[\s\S]*?delete slide\.dataset\.userPaused[\s\S]*?slide\.dataset\.userPaused = "true"[\s\S]*?video\.pause\(\)/,
  );
  assert.match(
    homeSource,
    /function activateHomeTvFeedVideo\(videoId\)[\s\S]*?slide\.dataset\.userPaused === "true"[\s\S]*?video\.pause\(\)[\s\S]*?return/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedFullscreenButton\(slide, video\)[\s\S]*?aria-hidden="true"[\s\S]*?toggleHomeTvFeedFullscreen\(slide, video\)/,
  );
  assert.match(
    homeSource,
    /function toggleHomeTvFeedFullscreen\(slide, video\)[\s\S]*?delete slide\.dataset\.userPaused;[\s\S]*?activateHomeTvFeedVideo\(videoId\);[\s\S]*?feed\.requestFullscreen\(\{ navigationUI: "hide" \}\)[\s\S]*?feed\.webkitRequestFullscreen\(\)[\s\S]*?setHomeTvFeedFallbackFullscreen\(true\)[\s\S]*?alignHomeTvFeedFullscreenSlide\(slide\)[\s\S]*?showHomeTvFeedFeedback\(slide, "Full screen", "neutral"\)/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen,[\s\S]*?overflow-y: auto !important;[\s\S]*?scroll-snap-type: y mandatory !important;[\s\S]*?#results\.home-tv-feed:fullscreen > \.home-tv-feed-slide,[\s\S]*?height: 100dvh !important;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: always;/,
  );
  assert.match(
    homeSource,
    /const fullscreenRoot = homeTvFeedIsImmersive\(\) \? results : null;[\s\S]*?root: fullscreenRoot,[\s\S]*?rootMargin: fullscreenRoot \? "0px" : "-72px 0px -88px"/,
  );
  assert.match(homeSource, /event\.key !== "Escape" \|\| !results\.classList\.contains\("is-fullscreen-feed"\)[\s\S]*?setHomeTvFeedFallbackFullscreen\(false\)/);
  const fullscreenToggle = homeSource.match(
    /async function toggleHomeTvFeedFullscreen\(slide, video\) \{[\s\S]*?(?=\n    function showHomeTvFeedFeedback)/,
  )?.[0] || "";
  assert.doesNotMatch(fullscreenToggle, /slide\.requestFullscreen|video\.webkitEnterFullscreen/);
});

test("TV sound and lower-right fullscreen controls stay consistent and icon-only", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-sound \{[\s\S]*?width: 52px;[\s\S]*?min-width: 52px;[\s\S]*?max-width: 52px;[\s\S]*?height: 52px;[\s\S]*?min-height: 52px;[\s\S]*?max-height: 52px;[\s\S]*?padding: 0;/,
  );
  const soundFactory = homeSource.match(
    /function createHomeTvFeedSoundButton\(slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedFullscreenButton)/,
  )?.[0] || "";
  const fullscreenFactory = homeSource.match(
    /function createHomeTvFeedFullscreenButton\(slide, video\) \{[\s\S]*?(?=\n    function renderHomeTvFeedSlide)/,
  )?.[0] || "";
  assert.match(soundFactory, /sound\.innerHTML = '<svg[\s\S]*?<\/svg>'/);
  assert.match(fullscreenFactory, /button\.className = "home-tv-feed-action home-tv-feed-fullscreen"/);
  assert.match(fullscreenFactory, /button\.innerHTML = '<svg[\s\S]*?<\/svg>'/);
  assert.doesNotMatch(fullscreenFactory, /<span|Full screen<\/span>/);
  assert.doesNotMatch(
    soundFactory.match(/sound\.innerHTML = '[^']*'/)?.[0] || "",
    /<span|Sound off|Sound on/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedSoundButtons\(\)[\s\S]*?button\.setAttribute\("aria-label", label\)[\s\S]*?button\.setAttribute\("aria-pressed", String\(!homeTvFeedMuted\)\)/,
  );
  const soundSync = homeSource.match(
    /function syncHomeTvFeedSoundButtons\(\)[\s\S]*?(?=\n    function homeTvFeedFullscreenElement)/,
  )?.[0] || "";
  assert.doesNotMatch(soundSync, /setAttribute\("title"/);
  assert.doesNotMatch(soundFactory, /showHomeTvFeedFeedback[\s\S]*?Sound off|showHomeTvFeedFeedback[\s\S]*?Sound on/);
  assert.match(
    homeSource,
    /function syncHomeTvFeedFullscreenButtons\(\)[\s\S]*?button\.setAttribute\("aria-label", label\)[\s\S]*?button\.setAttribute\("title", label\)/,
  );
});

test("idle TV utility controls use frosted-clear glass while selected reactions keep restrained violet", () => {
  const neutralControls = aestheticSource.match(
    /\/\* TV utility controls remain neutral[\s\S]*?(?=\/\* Active applause and follow states)/,
  )?.[0] || "";
  const activeControls = aestheticSource.match(
    /\/\* Active applause and follow states[\s\S]*?(?=\/\* The hero beam is a state signal)/,
  )?.[0] || "";

  assert.match(neutralControls, /\.home-tv-feed-sound/);
  assert.match(neutralControls, /\.home-tv-feed-action:not\(\.home-tv-feed-deal-action\)/);
  assert.match(neutralControls, /\.tv-shell \.tv-sound/);
  assert.match(neutralControls, /border-color: var\(--dancr-color-white-medium\) !important;/);
  assert.match(neutralControls, /background-color: var\(--dancr-color-black-soft\) !important;/);
  assert.match(neutralControls, /background-image: none !important;/);
  assert.match(neutralControls, /color: var\(--dancr-color-text-primary\) !important;/);
  assert.match(neutralControls, /backdrop-filter: blur\(14px\) saturate\(1\.08\) !important;/);
  assert.match(neutralControls, /drop-shadow\(0 1px 2px var\(--dancr-color-black-strong\)\)/);
  assert.doesNotMatch(neutralControls, /radial-gradient|brand-primary|beam-violet/);

  assert.match(activeControls, /\.home-tv-feed-report-action/);
  assert.match(activeControls, /\.home-tv-feed-fullscreen/);
  assert.match(activeControls, /:is\(\.is-active, \[aria-pressed="true"\]\)/);
  assert.match(activeControls, /var\(--dancr-color-brand-primary-soft\)/);
  assert.equal(
    (aestheticSource.match(/\.home-tv-feed-report-action,\s*\.home-tv-feed-fullscreen/g) || []).length,
    2,
  );
  assert.match(
    aestheticSource,
    /\.home-tv-feed-fullscreen\[aria-pressed="true"\] \{[\s\S]*?border-color: var\(--dancr-color-white-medium\) !important;[\s\S]*?background-color: var\(--dancr-color-black-medium\) !important;[\s\S]*?background-image: none !important;[\s\S]*?0 5px 16px var\(--dancr-color-black-medium\)/,
  );
  assert.match(homeSource, /dancr-aesthetic\.v1\.css\?v=111/);
});

test("production TV cards use the neutral-first brand palette without changing media or navigation", () => {
  const brandedCards = aestheticSource.match(
    /\/\* Production TV-card branding keeps the moving media as the visual hero\.[\s\S]*?(?=\/\* Production venue-detail refinement)/,
  )?.[0] || "";

  assert.match(brandedCards, /\.home-tv-feed-slide/);
  assert.match(brandedCards, /\.tv-shell :is\(/);
  assert.match(brandedCards, /border: 0 !important;/);
  assert.match(brandedCards, /\.home-tv-feed-dancer-photo/);
  assert.match(
    brandedCards,
    /\[data-dancer-avatar-border\] \{[\s\S]*?border: 2px solid var\(--dancr-color-avatar-ring-inactive\) !important;[\s\S]*?\[data-dancer-avatar-border\] > img,[\s\S]*?\[data-dancer-avatar-border\] > \.tv-profile-photo-image \{[\s\S]*?inset: 2px !important;[\s\S]*?width: calc\(100% - 4px\) !important;/,
  );
  assert.match(
    brandedCards,
    /body\.dancr-button-system \[data-dancer-avatar\] \{[\s\S]*?position: relative !important;[\s\S]*?isolation: isolate !important;[\s\S]*?border: 0 !important;[\s\S]*?body\.dancr-button-system \[data-dancer-avatar-border\] \{[\s\S]*?border: 2px solid var\(--dancr-color-avatar-ring-inactive\) !important;/,
  );
  assert.match(
    brandedCards,
    /\.home-tv-feed-progress \{[\s\S]*?background: var\(--dancr-color-white-medium\) !important;[\s\S]*?\.home-tv-feed-progress > span \{[\s\S]*?background: color-mix\(in srgb, var\(--dancr-color-text-primary\) 88%, transparent\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.doesNotMatch(
    brandedCards.match(/\.home-tv-feed-progress > span \{[\s\S]*?\}/)?.[0] || "",
    /brand-primary|brand-glow|linear-gradient/,
  );
  const playbackControl = brandedCards.match(
    /\.home-tv-feed-playback \{[\s\S]*?\}/,
  )?.[0] || "";
  assert.match(playbackControl, /border-color: var\(--dancr-color-white-medium\) !important;/);
  assert.match(playbackControl, /color: var\(--dancr-color-text-primary\) !important;/);
  assert.match(playbackControl, /background-color: var\(--dancr-color-black-medium\) !important;/);
  assert.match(playbackControl, /background-image: none !important;/);
  assert.doesNotMatch(playbackControl, /brand-|beam-|gradient|glow/);
  const neutralFullscreenFeedback = brandedCards.match(
    /\.home-tv-feed-feedback\.is-neutral \{[\s\S]*?\}/,
  )?.[0] || "";
  assert.match(neutralFullscreenFeedback, /border-color: var\(--dancr-color-white-medium\) !important;/);
  assert.match(neutralFullscreenFeedback, /background-color: var\(--dancr-color-black-medium\) !important;/);
  assert.match(neutralFullscreenFeedback, /box-shadow: 0 12px 34px var\(--dancr-color-black-strong\) !important;/);
  assert.doesNotMatch(neutralFullscreenFeedback, /brand-|beam-|gradient|glow/);
  assert.match(brandedCards, /\.home-tv-feed-verified/);
  assert.match(brandedCards, /background: var\(--mydancr-verified-surface\) !important;/);
  assert.match(brandedCards, /border-color: var\(--mydancr-verified-outline\) !important;/);
  assert.doesNotMatch(
    brandedCards.match(/\.home-tv-feed-verified[\s\S]*?\{[\s\S]*?\}/)?.[0] || "",
    /glow|box-shadow:(?!\s*none)/,
  );
  assert.match(brandedCards, /\.home-tv-feed-schedule\.is-now/);
  assert.match(brandedCards, /var\(--dancr-color-success\)/);
  assert.match(brandedCards, /\.home-tv-feed-schedule\.is-upcoming/);
  assert.match(brandedCards, /\.home-tv-feed-report-action\[aria-expanded="true"\]/);
  assert.match(brandedCards, /var\(--dancr-color-danger\)/);
  assert.doesNotMatch(brandedCards, /home-bottom|global-mobile-bottom-nav|discoveryTabs|home-nav/);
  assert.doesNotMatch(brandedCards, /\.home-tv-feed-video|\.tv-player video/);
  const brandedCardsWithoutAvatarRing = brandedCards
    .replace(
      /\/\* Every real dancer avatar keeps its existing outer dimensions[\s\S]*?(?=body\.dancr-button-system \.home-tv-feed-dancer-photo:not)/,
      "",
    );
  assert.doesNotMatch(
    brandedCardsWithoutAvatarRing,
    /\b(?:width|height|padding|margin|position|inset|display|grid|flex|gap|overflow|transform|transition|animation):/,
  );
});

test("iPhone autoplay flags are applied before a TV card starts loading media", () => {
  assert.match(
    homeSource,
    /const video = document\.createElement\("video"\)[\s\S]*?video\.autoplay = index === 0[\s\S]*?video\.muted = homeTvFeedMuted[\s\S]*?video\.defaultMuted = homeTvFeedMuted[\s\S]*?video\.setAttribute\("playsinline", ""\)[\s\S]*?video\.setAttribute\("webkit-playsinline", ""\)[\s\S]*?video\.setAttribute\("muted", ""\)[\s\S]*?video\.src = item\.videoUrl/,
  );
  assert.match(
    homeSource,
    /function activateHomeTvFeedVideo\(videoId\)[\s\S]*?video\.setAttribute\("autoplay", ""\)[\s\S]*?video\.setAttribute\("webkit-playsinline", ""\)[\s\S]*?video\.play\(\)/,
  );
  assert.match(
    homeSource,
    /video\.preload = index === 0 \? "auto" : "none"/,
  );
  assert.match(
    homeSource,
    /video\.play\(\)\.then\(\(\) => \{[\s\S]*?primeHomeTvFeedNeighbors\(videoId\)/,
  );
});
