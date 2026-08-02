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
    /\.home-tv-feed-dancer \{[\s\S]*?min-height: 64px;[\s\S]*?grid-template-columns: 64px minmax\(0, 1fr\)[\s\S]*?gap: 10px;[\s\S]*?\.home-tv-feed-dancer-photo \{[\s\S]*?width: 64px;[\s\S]*?height: 64px;[\s\S]*?border-radius: 999px;[\s\S]*?\.home-tv-feed-dancer-photo img \{[\s\S]*?object-fit: cover;[\s\S]*?\.home-tv-feed-dancer-copy \{[\s\S]*?\.home-tv-feed-dancer-name \{[\s\S]*?overflow-wrap: anywhere/,
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
  assert.doesNotMatch(homeSource, /home-tv-feed-dancer-actions|home-tv-feed-profile-action/);
  assert.match(
    homeSource,
    /const dancerPhotoUrl = String\(item\?\.dancer\?\.primaryPhotoUrl[\s\S]*?dancerPhoto\.className = "home-tv-feed-dancer-photo"[\s\S]*?dancerPhotoImage\.src = dancerPhotoUrl[\s\S]*?dancerPhotoImage\.addEventListener\("error", \(\) => dancerPhotoImage\.remove\(\)\)[\s\S]*?dancer\.append\(dancerPhoto, dancerCopy\)/,
  );
  assert.match(
    homeSource,
    /const hasLiveDeal = item\?\.shift\?\.isActive === true[\s\S]*?item\?\.venue\?\.id && item\?\.deal\?\.id && item\?\.dealAttributionToken[\s\S]*?home-tv-feed-deal-action home-card-qr-rail-action[\s\S]*?deal\.dataset\.clubDealCta = encodeDealPass[\s\S]*?sourceType: "dancer_profile"[\s\S]*?deal\.dataset\.feedLiveQr = "true"/,
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
  assert.match(videoFactory, /video\.addEventListener\("loadeddata"[\s\S]*?classList\.remove\("is-media-loading", "is-media-unavailable"\)/);
  assert.match(videoFactory, /video\.addEventListener\("error"[\s\S]*?"Video unavailable"/);
  assert.match(
    homeSource,
    /function createHomeTvFeedProgress\(\)[\s\S]*?role", "progressbar"/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedProgress\(video, slide\)[\s\S]*?aria-valuenow/,
  );
});

test("TV cards expose separate right-side action icons with fullscreen anchored lower right", () => {
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";
  const renderFactory = homeSource.match(
    /function renderHomeTvFeedSlide\(slide, item, videoIndex, totalVideos\) \{[\s\S]*?(?=\n    function createHomeTvFeedSlide)/,
  )?.[0] || "";

  assert.match(actionsFactory, /createHomeTvFeedActionButton\([\s\S]*?"Applaud"[\s\S]*?"Share"[\s\S]*?follow\.dataset\.feedAction = "follow"[\s\S]*?createHomeTvFeedActionButton\([\s\S]*?"Report"/);
  assert.match(actionsFactory, /actions\.append\(applause, share, follow\)[\s\S]*?if \(deal\) actions\.appendChild\(deal\)[\s\S]*?actions\.append\(report, reportMenu\)/);
  assert.doesNotMatch(actionsFactory, /More video actions|home-tv-feed-action-menu|home-tv-feed-menu-action/);
  assert.match(actionsFactory, /event\.key !== "Escape"[\s\S]*?closeHomeTvFeedReportMenus\(\)/);
  assert.match(homeSource, /results\.addEventListener\("click", async \(event\) => \{\s*if \(!event\.target\.closest\("\.home-tv-feed-actions"\)\) closeHomeTvFeedReportMenus\(\)/);
  assert.match(renderFactory, /position,[\s\S]*?createHomeTvFeedSoundButton\(slide\),[\s\S]*?createHomeTvFeedActions\(item, slide\),[\s\S]*?createHomeTvFeedFullscreenButton\(slide, video\),[\s\S]*?createHomeTvFeedCopy/);
  assert.match(homeSource, /\.home-tv-feed-actions \{[\s\S]*?right: 12px;[\s\S]*?bottom: 76px;[\s\S]*?display: grid;[\s\S]*?gap: 9px;/);
  assert.match(homeSource, /\.home-tv-feed-fullscreen \{[\s\S]*?position: absolute;[\s\S]*?right: 12px;[\s\S]*?bottom: 20px;/);
  assert.match(homeSource, /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?background: #000 !important;/);
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
    /\.home-tv-feed-copy \{[\s\S]*?padding: 96px 0 34px 14px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-actions \{[\s\S]*?bottom: 76px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-fullscreen \{[\s\S]*?bottom: 20px;[\s\S]*?\.home-tv-feed-progress \{[\s\S]*?bottom: 7px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-progress \{[\s\S]*?height: 6px;[\s\S]*?background: color-mix\(in srgb, var\(--dancr-color-text-primary\) 58%, transparent\);[\s\S]*?box-shadow: 0 1px 5px var\(--dancr-color-black-strong\);[\s\S]*?\.home-tv-feed-progress > span \{[\s\S]*?background: var\(--dancr-color-text-primary\);[\s\S]*?box-shadow: none;/,
  );
  assert.doesNotMatch(
    homeSource.match(/\.home-tv-feed-progress > span \{[\s\S]*?\}/)?.[0] || "",
    /#a855f7|#22d3ee|linear-gradient/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-position \{\s*top: calc\(14px \+ env\(safe-area-inset-top\)\);\s*left: 12px;/,
  );
  assert.match(homeSource, /\.home-tv-feed-fullscreen \{\s*right: 10px;\s*bottom: 20px;/);
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

test("every uploaded video gets a vertically scrollable card with playback, applause, sharing, and reporting", () => {
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
    /position\.textContent = `Video \$\{videoIndex \+ 1\} of \$\{totalVideos\}`/,
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
  assert.match(
    homeSource,
    /Tap to play or pause, double tap to applaud[\s\S]*?scroll up or down for another video[\s\S]*?event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"[\s\S]*?event\.key === "a" \|\| event\.key === "A"/,
  );
  assert.match(
    homeSource,
    /feedback\.setAttribute\("role", "status"\)[\s\S]*?feedback\.setAttribute\("aria-live", "polite"\)/,
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

test("intentional pauses persist and every TV card exposes immersive fullscreen", () => {
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
    /function toggleHomeTvFeedFullscreen\(slide, video\)[\s\S]*?slide\.requestFullscreen\(\{ navigationUI: "hide" \}\)[\s\S]*?video\.webkitEnterFullscreen\(\)/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide:fullscreen,[\s\S]*?height: 100dvh;[\s\S]*?border-radius: 0;/,
  );
});

test("TV sound and lower-right fullscreen controls stay compact and icon-only", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-sound \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?padding: 0;/,
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
    /function syncHomeTvFeedSoundButtons\(\)[\s\S]*?button\.setAttribute\("aria-label", label\)[\s\S]*?button\.setAttribute\("title", label\)/,
  );
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
  assert.match(activeControls, /:is\(\.is-active, \[aria-pressed="true"\]\)/);
  assert.match(activeControls, /var\(--dancr-color-brand-primary-soft\)/);
  assert.match(homeSource, /dancr-aesthetic\.v1\.css\?v=55/);
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
});
