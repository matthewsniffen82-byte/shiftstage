import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { liveShellRoute } from "./helpers/live-shell-route.mjs";

const [layout, homeRoute, aesthetic, operations, consistency] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/venue-operations.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-ui-consistency.v1.css", import.meta.url), "utf8"),
]);

test("the root layout and homepage no longer render a demo mode banner", async () => {
  assert.doesNotMatch(layout, /MyDancrPreviewBanner|Demo mode notice/);
  assert.doesNotMatch(homeRoute, /myDancrPreviewBannerHtml|withPreviewBanner/);
  for (const production of [true, false]) {
    const response = await liveShellRoute({ production }).route.GET();
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /<aside[^>]*class="mydancr-preview-banner"|aria-label="Demo mode notice"/);
    assert.match(html, /<body class="dancr-button-system">/);
    assert.match(html, /id="platformAdminAuthLink"/);
  }
});

test("pages retain device safe-area clearance without desktop, mobile, or operations banner space", () => {
  const heights = [...aesthetic.matchAll(/--mydancr-preview-banner-height:\s*([^;]+);/g)].map(match => match[1]);
  assert.deepEqual(heights, ["0px"]);
  assert.match(aesthetic, /--mydancr-preview-banner-offset: calc\(var\(--mydancr-preview-banner-height\) \+ env\(safe-area-inset-top, 0px\)\);/);
  assert.match(aesthetic, /body\.dancr-button-system \{[\s\S]*?padding-top: var\(--mydancr-preview-banner-offset\) !important;/);
  for (const source of [aesthetic, operations, consistency]) {
    assert.doesNotMatch(source, /\.mydancr-preview-banner|\.venue-demo-disclosure/);
  }
  assert.doesNotMatch(operations, /--mydancr-preview-banner-offset:/);
});

test("full dancer and venue profiles account for the remaining device safe area", () => {
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
