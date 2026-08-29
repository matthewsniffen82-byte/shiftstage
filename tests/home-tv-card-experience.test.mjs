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
  assert.doesNotMatch(homeSource, /\.home-tv-feed-shade\b|className = "home-tv-feed-shade"/);
  assert.doesNotMatch(aestheticSource, /body\.dancr-button-system \.home-tv-feed-shade/);
  assert.match(
    homeSource,
    /\.home-tv-feed-dancer \{[\s\S]*?min-height: 48px;[\s\S]*?grid-template-columns: 48px minmax\(0, 1fr\)[\s\S]*?gap: 9px;[\s\S]*?font-size: clamp\(20px, 5vw, 26px\);[\s\S]*?\.home-tv-feed-dancer-photo \{[\s\S]*?width: 48px;[\s\S]*?height: 48px;[\s\S]*?border-radius: 999px;[\s\S]*?\.home-tv-feed-dancer-photo img \{[\s\S]*?object-fit: cover;[\s\S]*?\.home-tv-feed-dancer-copy \{[\s\S]*?gap: 2px;[\s\S]*?\.home-tv-feed-dancer-name \{[\s\S]*?overflow-wrap: anywhere/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-meta \{[\s\S]*?width: 100%;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-verified \{[\s\S]*?width: 17px[\s\S]*?height: 17px/,
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
    /actions\.className = "home-tv-feed-actions"[\s\S]*?follow\.className = `home-tv-feed-action home-tv-feed-follow-action feed-card-action[\s\S]*?follow\.dataset\.feedAction = "follow"[\s\S]*?follow\.dataset\.profile = dancerName[\s\S]*?follow\.dataset\.homeTvVideoId = videoId[\s\S]*?follow\.dataset\.iconOnlyAction = "true"[\s\S]*?follow\.innerHTML = actionIconMarkup\(isFollowed \? "check" : "personPlus"\)/,
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
    /function createHomeTvFeedProgress\(slide, video\)[\s\S]*?progress = document\.createElement\("canvas"\)[\s\S]*?scrubber = document\.createElement\("div"\)[\s\S]*?setAttribute\("role", "slider"\)[\s\S]*?aria-label", "Video playback position"/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedProgress\(video, slide\)[\s\S]*?progress instanceof HTMLCanvasElement[\s\S]*?progress\.getContext\("2d"\)[\s\S]*?context\.fillStyle = "rgba\(255, 255, 255, 0\.18\)"[\s\S]*?context\.fillStyle = "#f8f8fa"[\s\S]*?scrubber\.setAttribute\("aria-valuemax", String\(duration \|\| 1\)\)[\s\S]*?scrubber\.setAttribute\("aria-valuenow", String\(currentTime\)\)/,
  );
  assert.doesNotMatch(homeSource, /\.home-tv-feed-progress > span|progress\.appendChild\(document\.createElement\("span"\)\)/);
  assert.doesNotMatch(homeSource, /scrubber\.type = "range"|createElement\("input"\)[\s\S]{0,300}?home-tv-feed-scrubber/);
});

test("TV cards expose one compact priority rail and a standalone seek bar", () => {
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide, video\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";
  const renderFactory = homeSource.match(
    /function renderHomeTvFeedSlide\(slide, item, videoIndex, totalVideos\) \{[\s\S]*?(?=\n    function createHomeTvFeedSlide)/,
  )?.[0] || "";

  assert.match(actionsFactory, /const sound = createHomeTvFeedSoundButton\(slide\)[\s\S]*?"home-tv-feed-profile-action"[\s\S]*?actionIconMarkup\("profile"\)[\s\S]*?slide\.querySelector\("\.home-tv-feed-dancer"\)\?\.click\(\)[\s\S]*?"Share"[\s\S]*?follow\.dataset\.feedAction = "follow"/);
  assert.match(actionsFactory, /const fullscreen = createHomeTvFeedFullscreenButton\(slide, video\)[\s\S]*?actions\.append\(sound, profile\)[\s\S]*?if \(deal\) actions\.appendChild\(deal\)[\s\S]*?actions\.append\(share, follow, fullscreen\)[\s\S]*?actions\.append\(overflow, reportMenu\)/);
  assert.doesNotMatch(actionsFactory, /actionIconMarkup\("star"\)|"Applaud"/);
  assert.match(actionsFactory, /"home-tv-feed-overflow-action"[\s\S]*?"More video options"[\s\S]*?actionIconMarkup\("more"\)/);
  assert.doesNotMatch(actionsFactory, /actionIconMarkup\("report"\)/);
  assert.match(actionsFactory, /event\.key !== "Escape"[\s\S]*?closeHomeTvFeedReportMenus\(\)/);
  assert.match(homeSource, /results\.addEventListener\("click", async \(event\) => \{\s*if \(!event\.target\.closest\("\.home-tv-feed-actions"\)\) closeHomeTvFeedReportMenus\(\)/);
  assert.match(renderFactory, /playback,[\s\S]*?createHomeTvFeedActions\(item, slide, video\),[\s\S]*?createHomeTvFeedCopy[\s\S]*?createHomeTvFeedProgress\(slide, video\)/);
  assert.doesNotMatch(renderFactory, /createHomeTvFeedSoundButton\(slide\)|createHomeTvFeedFullscreenButton\(slide, video\)/);
  assert.doesNotMatch(renderFactory, /shade|home-tv-feed-shade|linear-gradient/);
  assert.match(homeSource, /\.home-tv-feed-actions \{[\s\S]*?right: 10px;[\s\S]*?bottom: 76px;[\s\S]*?display: grid;[\s\S]*?justify-items: end;[\s\S]*?gap: 6px;/);
  assert.match(homeSource, /\.home-tv-feed-fullscreen \{ position: relative; \}/);
  assert.doesNotMatch(homeSource, /function createHomeTvFeedVideoControls|className = "home-tv-feed-video-controls"/);
  assert.match(homeSource, /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?background: #000 !important;/);
});

test("TV cards render Deals only for an applicable verified live Club Deal", () => {
  const dealStateFactory = homeSource.match(
    /function homeTvFeedDealState\(item\) \{[\s\S]*?(?=\n    function closeHomeTvFeedReportMenus)/,
  )?.[0] || "";
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide, video\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";

  assert.match(dealStateFactory, /key: "available"[\s\S]*?key: "no-active-offer"[\s\S]*?key: "available-when-working"[\s\S]*?key: "not-available-now"/);
  assert.match(actionsFactory, /let deal = null;[\s\S]*?if \(dealState\.key === "available"\)/);
  assert.match(actionsFactory, /deal\.dataset\.cardActionSlot = "qr"/);
  assert.doesNotMatch(actionsFactory, /cardQrLabel|cardQrMessage|aria-disabled/);
  assert.match(actionsFactory, /if \(deal\) actions\.appendChild\(deal\)/);
  assert.match(actionsFactory, /home-tv-feed-deal-count">\$\{offerCount > 1 \? "Club Deals" : "Club Deal"\}/);
  assert.doesNotMatch(actionsFactory, /home-tv-feed-deal-count">NFC/);
  assert.doesNotMatch(fullTvFeedSource, /<TvClubDealUnavailable video=\{video\} \/>|function TvClubDealUnavailable/);
});

test("TV Club Deal states keep one fixed rounded-square shape", () => {
  const dealShell = homeSource.match(
    /\.home-tv-feed-deal-action \{[\s\S]*?\n        \}/,
  )?.[0] || "";
  const dealLabel = homeSource.match(
    /\.home-tv-feed-deal-count \{[\s\S]*?\n        \}/,
  )?.[0] || "";
  const actionsFactory = homeSource.match(
    /function createHomeTvFeedActions\(item, slide, video\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
  )?.[0] || "";

  assert.match(dealShell, /box-sizing: border-box !important;/);
  assert.match(dealShell, /width: 46px !important;[\s\S]*?min-width: 46px !important;[\s\S]*?max-width: 46px !important;/);
  assert.match(dealShell, /height: 46px !important;[\s\S]*?min-height: 46px !important;[\s\S]*?max-height: 46px !important;/);
  assert.match(dealShell, /padding: 5px 3px !important;[\s\S]*?border-radius: 14px !important;[\s\S]*?overflow: hidden !important;/);
  assert.match(dealLabel, /position: static;[\s\S]*?width: 100%;[\s\S]*?background: transparent;/);
  assert.equal((actionsFactory.match(/home-tv-feed-deal-count">\$\{offerCount > 1 \? "Club Deals" : "Club Deal"\}/g) || []).length, 1);
});

test("TV Club Deal branding keeps the active control semantic without introducing inactive presentation", () => {
  const stateStyles = aestheticSource.match(
    /\/\* An applicable TV Club Deal keeps the compact rail silhouette[\s\S]*?(?=\/\* Production venue-detail branding)/,
  )?.[0] || "";

  assert.match(stateStyles, /\.home-tv-feed-deal-action\.is-available \{[\s\S]*?var\(--dancr-color-success-strong\)/);
  assert.doesNotMatch(stateStyles, /\.home-tv-feed-deal-action\.is-unavailable/);
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

test("mobile TV seek and utility controls stay inside the stable card that snaps above navigation", () => {
  assert.match(
    homeSource,
    /@media \(max-width: 760px\) \{[\s\S]*?\.home-tv-feed-copy \{[\s\S]*?padding: 64px 0 24px 12px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-actions \{[\s\S]*?bottom: 76px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-progress \{[\s\S]*?right: 14px;[\s\S]*?bottom: 8px;[\s\S]*?left: 14px;[\s\S]*?width: calc\(100% - 28px\);[\s\S]*?height: 3px;[\s\S]*?overflow: hidden;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?pointer-events: none;/,
  );
  assert.doesNotMatch(homeSource, /\.home-tv-feed-progress > span|transition: width \.1s linear/);
  assert.match(homeSource, /\.home-tv-feed-scrubber \{[\s\S]*?right: 14px;[\s\S]*?bottom: 0;[\s\S]*?left: 14px;[\s\S]*?height: 28px;[\s\S]*?background: transparent !important;[\s\S]*?backdrop-filter: none !important;[\s\S]*?filter: none !important;[\s\S]*?appearance: none !important;[\s\S]*?accent-color: transparent !important;[\s\S]*?opacity: 0 !important;[\s\S]*?touch-action: none;/);
  assert.doesNotMatch(homeSource, /\.home-tv-feed-scrubber::-(?:webkit-slider|moz-range)/);
  assert.match(homeSource, /\.home-tv-feed-scrubber:focus-visible \{[\s\S]*?border-color: transparent !important;[\s\S]*?outline: 0 !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(
    homeSource,
    /\.home-tv-feed-scrubber\[aria-disabled="true"\] \{[\s\S]*?opacity: 0 !important;[\s\S]*?pointer-events: none;/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedProgress\(slide, video\)[\s\S]*?scrubber\.setAttribute\("aria-valuemax", "1"\)[\s\S]*?scrubber\.setAttribute\("aria-disabled", "true"\)[\s\S]*?addEventListener\("pointerdown"[\s\S]*?addEventListener\("pointermove"[\s\S]*?addEventListener\("pointerup"[\s\S]*?addEventListener\("keydown"/,
  );
  assert.doesNotMatch(homeSource, /scrubber\.disabled = !duration|\.home-tv-feed-scrubber:disabled/);
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\);/,
  );
  assert.doesNotMatch(homeSource, /\.home-tv-feed-position|position\.textContent = `Video/);
  assert.doesNotMatch(homeSource, /\.home-tv-feed-video-controls \{/);
});

test("full-view TV actions and identity clear the device bottom edge together", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen \.home-tv-feed-progress,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed \.home-tv-feed-progress \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?height: 3px !important;[\s\S]*?display: block !important;[\s\S]*?visibility: visible !important;[\s\S]*?background: transparent !important;[\s\S]*?opacity: 1 !important;/,
  );
  assert.doesNotMatch(homeSource, /#results\.home-tv-feed(?::fullscreen|\.is-fullscreen-feed) \.home-tv-feed-progress > span/);
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen \.home-tv-feed-scrubber,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed \.home-tv-feed-scrubber \{[\s\S]*?bottom: env\(safe-area-inset-bottom, 0px\);/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen \.home-tv-feed-copy,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed \.home-tv-feed-copy \{[\s\S]*?bottom: calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen \.home-tv-feed-actions,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed \.home-tv-feed-actions \{[\s\S]*?bottom: calc\(42px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-fullscreen \{ position: relative; \}/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-full-view-close \{[\s\S]*?display: none;[\s\S]*?backdrop-filter: blur\(14px\) saturate\(1\.12\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-full-view-close\[hidden\] \{[\s\S]*?display: none !important;/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed:fullscreen \.home-tv-feed-full-view-close,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed \.home-tv-feed-full-view-close \{[\s\S]*?display: grid;/,
  );
  assert.match(
    homeSource,
    /function createHomeTvFeedFullViewCloseButton\(slide, video\)[\s\S]*?"home-tv-feed-full-view-close"[\s\S]*?button\.hidden = !homeTvFeedIsImmersive\(\)[\s\S]*?if \(!homeTvFeedIsImmersive\(\)\) return;[\s\S]*?toggleHomeTvFeedFullscreen\(slide, video\)/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedFullscreenButtons\(\)[\s\S]*?\[data-home-tv-full-view-close\][\s\S]*?button\.hidden = !feedIsFullscreen/,
  );
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
    /if \(scheduleContext \|\| venueName\)[\s\S]*?context\.className = "home-tv-feed-context"[\s\S]*?if \(scheduleContext\)[\s\S]*?context\.appendChild\(schedule\)[\s\S]*?if \(venueName\)[\s\S]*?venue\.className = "home-tv-feed-venue"[\s\S]*?context\.appendChild\(venue\)[\s\S]*?copy\.appendChild\(context\)/,
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
      /function createHomeTvFeedActions\(item, slide, video\) \{[\s\S]*?(?=\n    function createHomeTvFeedSoundButton)/,
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
  const progressFactory =
    homeSource.match(
      /function createHomeTvFeedProgress\(slide, video\) \{[\s\S]*?(?=\n    function showRelativeHomeTvFeedSlide)/,
    )?.[0] || "";
  assert.match(
    progressFactory,
    /createElement\("div"\)[\s\S]*?setAttribute\("role", "slider"\)[\s\S]*?tabIndex = 0[\s\S]*?aria-label", "Video playback position"[\s\S]*?aria-valuetext", "Video loading"/,
  );
  assert.match(
    progressFactory,
    /scrubber\.addEventListener\("pointerdown"[\s\S]*?seekToClientX\(event\.clientX\)[\s\S]*?scrubber\.addEventListener\("keydown"[\s\S]*?video\.currentTime = Math\.min[\s\S]*?syncHomeTvFeedProgress\(video, slide\)/,
  );
  assert.match(homeSource, /function syncHomeTvFeedProgress\(video, slide\)[\s\S]*?formatProfileTvDuration\(currentTime\)[\s\S]*?formatProfileTvDuration\(duration\)/);
  assert.doesNotMatch(homeSource, /function showHomeTvFeedControls|is-controls-visible|homeTvControlsTimer/);
  assert.match(homeSource, /function syncHomeTvFeedFullscreenState\(\)[\s\S]*?alignHomeTvFeedFullscreenSlide\(activeSlide\)/);
  assert.match(
    homeSource,
    /Tap to play or pause, double tap to applaud[\s\S]*?scroll up or down for another video[\s\S]*?event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"[\s\S]*?event\.key === "a" \|\| event\.key === "A"[\s\S]*?toggleHomeTvFeedPlayback\(video\)/,
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

test("TV sound and fullscreen controls share the compact rail and remain icon-only", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-action \{[\s\S]*?width: 46px;[\s\S]*?min-width: 46px;[\s\S]*?max-width: 46px;[\s\S]*?height: 46px;[\s\S]*?min-height: 46px;[\s\S]*?max-height: 46px;/,
  );
  const soundFactory = homeSource.match(
    /function createHomeTvFeedSoundButton\(slide\) \{[\s\S]*?(?=\n    function createHomeTvFeedFullscreenButton)/,
  )?.[0] || "";
  const fullscreenFactory = homeSource.match(
    /function createHomeTvFeedFullscreenButton\(slide, video\) \{[\s\S]*?(?=\n    function createHomeTvFeedFullViewCloseButton)/,
  )?.[0] || "";
  assert.match(soundFactory, /sound\.className = "home-tv-feed-action home-tv-feed-sound"/);
  assert.match(soundFactory, /sound\.innerHTML = '<svg[\s\S]*?<\/svg>'/);
  assert.match(fullscreenFactory, /button\.className = "home-tv-feed-action home-tv-feed-fullscreen"/);
  assert.match(fullscreenFactory, /button\.innerHTML = \[[\s\S]*?home-tv-feed-video-expand-icon[\s\S]*?home-tv-feed-video-collapse-icon[\s\S]*?\.join\(""\)/);
  assert.doesNotMatch(fullscreenFactory, /<span|Full screen<\/span>/);
  assert.doesNotMatch(
    soundFactory.match(/sound\.innerHTML = '[^']*'/)?.[0] || "",
    /<span|Sound off|Sound on/,
  );
  assert.match(
    homeSource,
    /function syncHomeTvFeedSoundButtons\(\)[\s\S]*?button\.setAttribute\("aria-label", label\)[\s\S]*?button\.setAttribute\("title", label\)[\s\S]*?button\.setAttribute\("aria-pressed", String\(!homeTvFeedMuted\)\)/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-action:not\(\.home-tv-feed-sound\)\[aria-pressed="true"\]/,
  );
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

  assert.match(activeControls, /\.home-tv-feed-overflow-action/);
  assert.match(activeControls, /\.home-tv-feed-fullscreen/);
  assert.match(activeControls, /:is\(\.is-active, \[aria-pressed="true"\]\)/);
  assert.match(
    activeControls,
    /\.home-tv-feed-fullscreen,\s*\.home-tv-feed-sound\s*\):is\(\.is-active, \[aria-pressed="true"\]\)/,
  );
  assert.match(activeControls, /var\(--dancr-color-brand-primary-soft\)/);
  assert.equal(
    (aestheticSource.match(/\.home-tv-feed-overflow-action,\s*\.home-tv-feed-fullscreen/g) || []).length,
    2,
  );
  assert.match(
    aestheticSource,
    /\.home-tv-feed-fullscreen\[aria-pressed="true"\] \{[\s\S]*?border-color: var\(--dancr-color-white-medium\) !important;[\s\S]*?background-color: var\(--dancr-color-black-medium\) !important;[\s\S]*?background-image: none !important;[\s\S]*?0 5px 16px var\(--dancr-color-black-medium\)/,
  );
  assert.match(homeSource, /dancr-aesthetic\.v1\.css\?v=226/);
});

test("production TV cards use the neutral-first brand palette without changing media or navigation", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-schedule\.is-now \{[\s\S]*?background: var\(--dancr-color-live-surface-glass, rgba\(16,185,129,\.60\)\);/,
  );
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
    /\.home-tv-feed-progress \{[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?opacity: 1 !important;[\s\S]*?mix-blend-mode: normal !important;[\s\S]*?filter: none !important;/,
  );
  assert.doesNotMatch(brandedCards, /\.home-tv-feed-progress > span/);
  assert.match(brandedCards, /\.home-tv-feed-scrubber \{[\s\S]*?background: transparent !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;[\s\S]*?backdrop-filter: none !important;[\s\S]*?filter: none !important;[\s\S]*?appearance: none !important;[\s\S]*?accent-color: transparent !important;[\s\S]*?opacity: 0 !important;/);
  assert.match(brandedCards, /\.home-tv-feed-scrubber:is\(:focus, :focus-visible, :active\) \{[\s\S]*?border-color: transparent !important;[\s\S]*?outline: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.doesNotMatch(brandedCards, /home-tv-feed-scrubber::-(?:webkit-slider|moz-range)/);
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
  const cityLabel = brandedCards.match(
    /body\.dancr-button-system \.home-tv-feed-meta \{[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(cityLabel, /color: var\(--dancr-color-text-primary\) !important;/);
  assert.match(cityLabel, /-webkit-text-fill-color: currentColor !important;/);
  assert.match(cityLabel, /opacity: 1 !important;/);
  assert.match(cityLabel, /var\(--dancr-color-black-strong\) !important;/);
  assert.match(cityLabel, /filter: none !important;/);
  assert.doesNotMatch(cityLabel, /dancr-color-(?:brand|info|live|success|featured|danger)/);
  const workingNowPill = brandedCards.match(
    /body\.dancr-button-system \.home-tv-feed \.home-tv-feed-schedule\.is-now \{[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(workingNowPill, /border-color: var\(--dancr-color-live-strong\) !important;/);
  assert.match(workingNowPill, /color: #d9ffea !important;/);
  assert.match(
    workingNowPill,
    /background-color: var\(--dancr-color-live-surface-glass, rgba\(16, 185, 129, 0\.60\)\) !important;/,
  );
  assert.match(workingNowPill, /background-image: none !important;/);
  assert.match(workingNowPill, /box-shadow: inset 0 1px 0 rgba\(224, 255, 242, 0\.14\) !important;/);
  assert.match(workingNowPill, /backdrop-filter: blur\(10px\) saturate\(120%\) !important;/);
  assert.doesNotMatch(workingNowPill, /brand-|beam-|gradient|glow/);
  assert.doesNotMatch(workingNowPill, /(?:height|padding|border-radius):/);
  const upcomingPill = brandedCards.match(
    /body\.dancr-button-system \.home-tv-feed \.home-tv-feed-schedule\.is-upcoming \{[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(upcomingPill, /border-color: var\(--dancr-color-info-strong\) !important;/);
  assert.match(upcomingPill, /color: #dcfbff !important;/);
  assert.match(
    upcomingPill,
    /background-color: var\(--dancr-color-info-surface-glass, rgba\(8, 145, 178, 0\.66\)\) !important;/,
  );
  assert.match(upcomingPill, /box-shadow: inset 0 1px 0 rgba\(224, 252, 255, 0\.14\) !important;/);
  assert.match(upcomingPill, /backdrop-filter: blur\(10px\) saturate\(120%\) !important;/);
  assert.doesNotMatch(upcomingPill, /brand-|beam-|gradient|glow/);
  assert.doesNotMatch(upcomingPill, /(?:height|padding|border-radius):/);
  assert.match(brandedCards, /var\(--dancr-color-success\)/);
  assert.match(brandedCards, /\.home-tv-feed-schedule\.is-upcoming/);
  assert.match(brandedCards, /\.home-tv-feed-overflow-action\[aria-expanded="true"\]/);
  assert.match(brandedCards, /\.home-tv-feed-report-option:is\(:hover, :focus-visible\)[\s\S]*?var\(--dancr-color-danger-medium\)/);
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
