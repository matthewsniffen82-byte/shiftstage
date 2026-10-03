import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, homeRoute, aesthetic, venueStyles, profileStyles, mediaStyles, legalStyles] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/venue-operations.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancer-profile-layout.css", import.meta.url), "utf8"),
  readFile(new URL("../public/profile-media-card-feed.css", import.meta.url), "utf8"),
  readFile(new URL("../app/components/legal-document.css", import.meta.url), "utf8"),
]);

test("public pages and dashboards no longer render a demo banner", () => {
  assert.doesNotMatch(layout + homeRoute, /MyDancrPreviewBanner|myDancrPreviewBannerHtml|mydancr-preview-banner/);
  assert.doesNotMatch(aesthetic + venueStyles, /\.mydancr-preview-banner|venue-demo-disclosure/);
  assert.match(aesthetic, /--mydancr-preview-banner-offset: env\(safe-area-inset-top, 0px\);/);
  assert.match(aesthetic, /body\.dancr-button-system \{[\s\S]*?padding-top: var\(--mydancr-preview-banner-offset\) !important;/);
});

test("mobile, desktop and venue layouts do not retain a reserved demo strip", () => {
  assert.doesNotMatch(aesthetic + venueStyles, /--mydancr-preview-banner-(?:height|offset):\s*(?:34|36|46)px/);
  assert.doesNotMatch(profileStyles + legalStyles, /var\(--mydancr-preview-banner-offset,\s*(?:34|46)px\)/);
  assert.match(mediaStyles, /\.public-profile-shell \.profile-media-viewer[^{}]+\{\s*top: 0 !important;\s*height: 100vh !important;\s*height: 100dvh !important;/);
  assert.match(mediaStyles, /padding: env\(safe-area-inset-top, 0px\) 13px 0;/);
});

test("full dancer and venue profiles retain safe-area protection and reachable close controls", () => {
  assert.match(
    aesthetic,
    /\.page-panel\.show \{[\s\S]*?top: var\(--mydancr-preview-banner-offset\) !important;[\s\S]*?height: calc\(100dvh - var\(--mydancr-preview-banner-offset\)\) !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop\.modal-backdrop,[\s\S]*?#profileBackdrop\.modal-backdrop\.show \{[\s\S]*?top: var\(--mydancr-preview-banner-offset\) !important;[\s\S]*?height: calc\(100dvh - var\(--mydancr-preview-banner-offset\)\) !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-modal \{[\s\S]*?max-height: min\(94vh, calc\(100dvh - var\(--mydancr-preview-banner-offset\)\)\) !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.venue-profile-overlay \{[\s\S]*?top: var\(--mydancr-preview-banner-offset\) !important;[\s\S]*?height: calc\(100dvh - var\(--mydancr-preview-banner-offset\)\) !important;[\s\S]*?padding-top: max\(10px, var\(--dancr-viewport-top\)\) !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop #modalClose \{[\s\S]*?top: 8px !important;[\s\S]*?transform: none !important;/,
  );
  assert.doesNotMatch(
    aesthetic,
    /\.venue-detail-close \{[\s\S]*?top: calc\(var\(--mydancr-preview-banner-offset\)/,
  );
});
