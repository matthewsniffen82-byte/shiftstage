import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, homeRoute, banner, routeAwareBanner, aesthetic] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/MyDancrPreviewBanner.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/RouteAwarePreviewBanner.tsx", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("the root layout presents one persistent preview notice across the application", () => {
  assert.equal((layout.match(/<RouteAwarePreviewBanner \/>/g) || []).length, 1);
  assert.match(routeAwareBanner, /pathname\.startsWith\("\/age-verification"\)/);
  assert.match(banner, /DEMO MODE/);
  assert.match(banner, /All profiles, venues, schedules, offers, and activity shown are fictional demo content\./);
  assert.doesNotMatch(banner, /TEST\s+SITE|shown are test\s+data/);
  assert.doesNotMatch(banner, /MyDancr Preview|Venue participation/);
  assert.equal((banner.match(/aria-label="Demo mode notice"/g) || []).length, 2);
  assert.match(homeRoute, /myDancrPreviewBannerHtml/);
  assert.match(homeRoute, /<body class=\"dancr-button-system\">\$\{myDancrPreviewBannerHtml\}/);
  assert.match(aesthetic, /\.mydancr-preview-banner \{[\s\S]*?position: fixed;[\s\S]*?inset: 0 0 auto;/);
  assert.match(aesthetic, /body\.dancr-button-system \{[\s\S]*?padding-top: var\(--mydancr-preview-banner-offset\) !important;/);
});

test("the preview notice remains compact and responsive on mobile", () => {
  assert.match(aesthetic, /@media \(max-width: 600px\)[\s\S]*?--mydancr-preview-banner-height: 46px;/);
  assert.match(aesthetic, /\.mydancr-preview-banner span \{[\s\S]*?max-width: min\(52ch, 100%\);/);
  assert.match(aesthetic, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?backdrop-filter: none;/);
});

test("full dancer and venue profiles remain entirely below the persistent notice", () => {
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
