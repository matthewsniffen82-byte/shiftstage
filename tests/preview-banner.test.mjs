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
  assert.match(banner, /MyDancr Preview/);
  assert.match(banner, /Venue participation, schedules, Club Deals, QR redemptions, and earnings are test-only\./);
  assert.match(homeRoute, /myDancrPreviewBannerHtml/);
  assert.match(homeRoute, /<body class=\"dancr-button-system\">\$\{myDancrPreviewBannerHtml\}/);
  assert.match(aesthetic, /\.mydancr-preview-banner \{[\s\S]*?position: fixed;[\s\S]*?inset: 0 0 auto;/);
  assert.match(aesthetic, /body\.dancr-button-system \{[\s\S]*?padding-top: var\(--mydancr-preview-banner-offset\) !important;/);
});

test("the preview notice remains compact and responsive on mobile", () => {
  assert.match(aesthetic, /@media \(max-width: 520px\)[\s\S]*?--mydancr-preview-banner-height: 50px;/);
  assert.match(aesthetic, /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?backdrop-filter: none;/);
});
