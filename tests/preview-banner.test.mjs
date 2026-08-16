import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, homeRoute, aesthetic, dashboard] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("the demo banner is absent from every application shell", () => {
  for (const source of [layout, homeRoute, aesthetic, dashboard]) {
    assert.doesNotMatch(source, /MyDancrPreviewBanner|myDancrPreviewBannerHtml/);
    assert.doesNotMatch(source, /mydancr-preview-banner/);
    assert.doesNotMatch(source, /Demo mode notice/);
  }
  assert.match(homeRoute, /const withAdminAuthEntry = withLiveProfileAssets\.replace\(/);
});

test("removing the banner also removes its reserved top spacing", () => {
  assert.doesNotMatch(aesthetic, /padding-top:\s*var\(--mydancr-preview-banner-offset\)/);
  assert.doesNotMatch(aesthetic, /--mydancr-preview-banner-(?:height|offset)/);
  assert.doesNotMatch(dashboard, /--mydancr-preview-banner-offset/);
});

test("full dancer and venue profiles use the complete viewport", () => {
  assert.match(
    aesthetic,
    /\.page-panel\.show \{[\s\S]*?top: 0 !important;[\s\S]*?height: 100dvh !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop\.modal-backdrop,[\s\S]*?#profileBackdrop\.modal-backdrop\.show \{[\s\S]*?top: 0 !important;[\s\S]*?height: 100dvh !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-modal \{[\s\S]*?max-height: min\(94vh, 100dvh\) !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.venue-profile-overlay \{[\s\S]*?top: 0 !important;[\s\S]*?height: 100dvh !important;[\s\S]*?padding-top: max\(10px, var\(--dancr-viewport-top\)\) !important;/,
  );
  assert.match(dashboard, /\.dancer-profile-preview-overlay \{[^}]*?inset: 0;/);
});
