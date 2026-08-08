import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, homeRoute, banner, aesthetic] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/MyDancrPreviewBanner.tsx", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("the root layout presents one persistent preview notice across the application", () => {
  assert.equal((layout.match(/<MyDancrPreviewBanner \/>/g) || []).length, 1);
  assert.match(banner, /TEST SITE/);
  assert.match(banner, /All profiles, affiliations, schedules, offers, and activity shown are test data\./);
  assert.doesNotMatch(banner, /MyDancr Preview|Venue participation/);
  assert.equal((banner.match(/aria-label="Test site notice"/g) || []).length, 2);
  assert.match(homeRoute, /myDancrPreviewBannerHtml/);
  assert.match(homeRoute, /<body class=\"dancr-button-system\">\$\{myDancrPreviewBannerHtml\}/);
  assert.match(aesthetic, /\.mydancr-preview-banner \{[\s\S]*?position: fixed;[\s\S]*?inset: 0 0 auto;/);
  assert.match(aesthetic, /body\.dancr-button-system \{[\s\S]*?padding-top: var\(--mydancr-preview-banner-offset\) !important;/);
});

test("the preview notice remains compact and responsive on mobile", () => {
  assert.match(aesthetic, /@media \(max-width: 520px\)[\s\S]*?--mydancr-preview-banner-height: 50px;/);
  assert.match(aesthetic, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?backdrop-filter: none;/);
});

test("full dancer and venue profiles remain entirely below the persistent notice", () => {
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
  assert.match(
    aesthetic,
    /#results\.venue-profile-overlay \.venue-detail \.venue-detail-close \{[\s\S]*?top: calc\(var\(--mydancr-preview-banner-offset\) \+ 12px\) !important;/,
  );
});
