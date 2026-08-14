import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, homeRoute, aesthetic] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("the application does not render a demo-mode banner", () => {
  assert.doesNotMatch(layout, /MyDancrPreviewBanner|mydancr-preview-banner|Demo mode notice/);
  assert.doesNotMatch(homeRoute, /MyDancrPreviewBanner|myDancrPreviewBannerHtml|mydancr-preview-banner|Demo mode notice/);
});

test("removing the banner also removes its reserved viewport space", () => {
  assert.doesNotMatch(aesthetic, /mydancr-preview-banner|mydancr-preview-banner-offset|mydancr-preview-banner-height/);
});
