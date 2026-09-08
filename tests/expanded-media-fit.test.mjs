import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [live, profile, tvStrip, dashboard] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("expanded profile photos and videos fill edge-to-edge without changing thumbnail crops", () => {
  assert.match(live, /\.profile-photo-viewer-slide-image \{[^}]*background-size: cover !important;/);
  assert.match(live, /\.profile-tv-viewer-video \{[^}]*object-fit: cover;/);
  assert.match(profile, /\.profile-media-viewer\.is-photo \.profile-media-viewer-slide > img \{ object-fit: cover; \}/);
  assert.match(profile, /\.profile-media-viewer\.is-video \.profile-media-viewer-slide > video \{ object-fit: cover; \}/);
  assert.match(tvStrip, /\.tv-video-viewer-stage > video \{[^}]*object-fit: cover;/);
  assert.match(profile, /\.profile-media-grid-item img, \.profile-media-grid-item video \{[^}]*object-fit: cover;/);
  assert.match(live, /\.home-tv-feed-video \{[^}]*object-fit: cover;/);
});

test("signed-in full-profile previews fill media within the dynamic viewport", () => {
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-media-viewer \{[^}]*height:100vh; height:100dvh; min-height:0;/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-media-viewer-slide \{[^}]*grid-template:minmax\(0,1fr\) \/ minmax\(0,1fr\);/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-media-viewer-slide > img, \.dancer-profile-preview-overlay \.profile-media-viewer-slide > video \{[^}]*min-width:0; min-height:0;[^}]*object-fit:cover;/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-media-grid-item img, \.dancer-profile-preview-overlay \.profile-media-grid-item video \{[^}]*object-fit: cover;/);
});

test("expanded viewers use the available dynamic viewport and parent-sized photo pages", () => {
  for (const [source, selector] of [
    [live, "profile-photo-viewer"],
    [live, "profile-tv-viewer"],
    [tvStrip, "tv-video-viewer"],
  ]) {
    const rule = source.match(new RegExp(`\\.${selector} \\{[^}]*\\}`))?.[0] || "";
    assert.match(rule, /height: 100vh;\s*height: 100dvh;/);
    assert.match(rule, /min-height: 0;/);
  }
  const photoPages = live.match(/\.profile-photo-viewer-image \{[^}]*\}/)?.[0] || "";
  assert.match(photoPages, /height: 100%;/);
  assert.match(photoPages, /width: 100%;/);
  assert.doesNotMatch(photoPages, /100[ds]?vh|100vw/);
  assert.match(photoPages, /scroll-snap-type: y mandatory;/);
  assert.match(profile, /\.profile-media-viewer-slide \{[^}]*grid-template: minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/);
  assert.match(profile, /\.profile-media-viewer-slide > img, \.profile-media-viewer-slide > video \{[^}]*min-width: 0; min-height: 0;/);
});

test("expanded TV fills video in native and fallback fullscreen without a large-viewport minimum", () => {
  const fullscreen = live.match(/#results\.home-tv-feed:fullscreen,[\s\S]*?#results\.home-tv-feed\.is-fullscreen-feed \{[^}]*\}/)?.[0] || "";
  assert.match(fullscreen, /height: 100dvh !important;/);
  assert.match(fullscreen, /min-height: 0 !important;/);
  assert.match(fullscreen, /max-height: 100dvh !important;/);
  assert.doesNotMatch(fullscreen, /min-height: 100vh/);
  assert.match(live, /#results\.home-tv-feed:is\(:fullscreen, :-webkit-full-screen, \.is-fullscreen-feed\) \.home-tv-feed-video \{\s*object-fit: cover;\s*\}/);
});

test("expanded close circles stay inset from the top and right safe-area edges", () => {
  for (const [source, selector] of [
    [live, "profile-photo-viewer-close"],
    [live, "profile-tv-viewer-close"],
    [live, "home-tv-feed-full-view-close"],
    [profile, "profile-media-viewer-close"],
    [tvStrip, "tv-video-viewer-close"],
    [dashboard, "dancer-profile-preview-overlay \\.profile-media-viewer-close"],
  ]) {
    const rule = source.match(new RegExp(`\\.${selector} \\{[^}]*\\}`))?.[0] || "";
    assert.match(rule, /top: calc\(16px \+ env\(safe-area-inset-top, 0px\)\)/);
    assert.match(rule, /right: calc\(16px \+ env\(safe-area-inset-right, 0px\)\)/);
  }
});
