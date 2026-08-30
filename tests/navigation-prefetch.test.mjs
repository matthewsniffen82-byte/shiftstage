import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, profileCarousel, videoStrip] = await Promise.all([
  "../outputs/index.html",
  "../app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "../app/components/TvVideoStrip.tsx",
].map((file) => readFile(new URL(file, import.meta.url), "utf8")));

test("profile navigation prefetch is connection-aware, bounded, and data-only", () => {
  const prefetch = liveShell.match(
    /function publicProfileForNavigation[\s\S]*?(?=\n    async function loadProfileMyDancrTv)/,
  )?.[0] || "";

  assert.match(liveShell, /const PROFILE_NAVIGATION_PREFETCH_TTL_MS = 20 \* 1000/);
  assert.match(liveShell, /const PROFILE_NAVIGATION_PREFETCH_LIMIT = 4/);
  assert.match(liveShell, /const profileNavigationPrefetchCache = new Map\(\)/);
  assert.match(prefetch, /if \(cached\?\.expiresAt > now\) return cached\.promise/);
  assert.match(prefetch, /while \(profileNavigationPrefetchCache\.size >= PROFILE_NAVIGATION_PREFETCH_LIMIT\)/);
  assert.match(prefetch, /fetch\(`\/api\/public\/tv\?\$\{params\.toString\(\)\}`/);
  assert.match(prefetch, /if \(!canWarmAdjacentVideo\(\)\) return/);
  assert.doesNotMatch(prefetch, /createElement\(["'](?:img|video)["']\)|\.src\s*=|preload=/);
});

test("visible and intent-signaled dancer cards prepare the same profile payload used on open", () => {
  const loader = liveShell.match(
    /async function loadProfileMyDancrTv\(profile\)[\s\S]*?(?=\n    function formatProfileTvShift)/,
  )?.[0] || "";

  assert.match(liveShell, /scheduleHomeDiscoveryFeedQrPrompt\(activeSlide\);\s*prefetchProfileNavigationFromElement\(activeSlide\)/);
  assert.match(liveShell, /requestAnimationFrame\(\(\) => \{\s*prefetchProfileNavigationFromElement\(results\.querySelector\("\.home-dancer-grid-card"\)\)/);
  assert.match(liveShell, /results\.addEventListener\("pointerover", handleProfileNavigationIntent, \{ passive: true \}\)/);
  assert.match(liveShell, /results\.addEventListener\("focusin", handleProfileNavigationIntent\)/);
  assert.match(liveShell, /results\.addEventListener\("touchstart", handleProfileNavigationIntent, \{ passive: true \}\)/);
  assert.match(liveShell, /dancer\.dataset\.profileReference = dancerSlug/);
  assert.match(liveShell, /dancer\.dataset\.profileCity = dancerCity/);
  assert.match(loader, /const payload = await requestProfileTvPayload\(profile, requestCity\)/);
  assert.doesNotMatch(loader, /fetch\(/);
});

test("venue navigation remains immediately available from the existing discovery payload", () => {
  const venueOpen = liveShell.match(
    /function openVenueFromName\(venueName, options = \{\}\)[\s\S]*?(?=\n    function focusVenueProfileStart)/,
  )?.[0] || "";

  assert.match(venueOpen, /const venue = resolveVenueByName\(venueName\)/);
  assert.match(venueOpen, /selectedVenueName = venue\.name/);
  assert.match(venueOpen, /render\(\)/);
  assert.doesNotMatch(venueOpen, /fetch\(/);
});

test("profile media opens directly from already-rendered poster grids", () => {
  assert.match(profileCarousel, /function openViewer[\s\S]*?flushSync\(\(\) => setViewer\(\{ kind, index \}\)\)/);
  assert.match(profileCarousel, /preload="none"/);
  assert.match(videoStrip, /onMouseEnter=\{\(event\) => playPreviewCard\(event\.currentTarget\)\}/);
  assert.match(videoStrip, /onClick=\{\(\) => \{[\s\S]*?setActiveVideo\(video\)/);
});
