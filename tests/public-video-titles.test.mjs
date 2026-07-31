import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  tvSource,
  liveApp,
  dancerPage,
  dancerCarousel,
  sharedVideoPage,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/[id]/page.tsx", import.meta.url), "utf8"),
]);

test("stored video captions never appear on public video surfaces", () => {
  const publicSelect =
    tvSource.match(/const PUBLIC_TV_SELECT =[\s\S]*?;\r?\n/)?.[0] || "";
  const publicVideoType =
    tvSource.match(/export type MyDancrTvVideo = \{[\s\S]*?\r?\n\};/)?.[0] || "";
  const publicNormalizer =
    tvSource.match(/function normalizeFeedRow\([\s\S]*?\r?\n\}/)?.[0] || "";

  assert.doesNotMatch(publicSelect, /\bcaption\b/);
  assert.doesNotMatch(publicVideoType, /\bcaption\b/);
  assert.doesNotMatch(publicNormalizer, /caption:\s*row\.caption/);
  assert.doesNotMatch(liveApp, /home-tv-feed-caption|item\?\.caption/);
  assert.doesNotMatch(dancerPage, /caption:\s*video\.caption|public-video-caption/);
  assert.doesNotMatch(dancerCarousel, /activeMedia\.caption|public-video-caption/);
  assert.doesNotMatch(sharedVideoPage, /description:\s*video\.caption/);
  assert.match(
    sharedVideoPage,
    /description:\s*`Watch \$\{video\.dancer\.stageName\} on MyDancr TV\.`/,
  );
});
