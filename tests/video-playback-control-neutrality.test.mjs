import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileCarousel = await readFile(
  new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url),
  "utf8",
);
const tvFeed = await readFile(
  new URL("../app/tv/TvFeedClient.tsx", import.meta.url),
  "utf8",
);
const aesthetic = await readFile(
  new URL("../public/dancr-aesthetic.v1.css", import.meta.url),
  "utf8",
);
const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("profile video grids open the shared viewer and playback controls remain neutral", () => {
  assert.match(profileCarousel, /<img[\s\S]*?src=\{item\.posterUrl\}[\s\S]*?className="profile-media-play"/);
  assert.match(profileCarousel, /viewerItems\.map\(\(item, index\) =>[\s\S]*?controls=\{false\}[\s\S]*?data-video-url=\{publicVideoPlaybackUrl\(item\)\}[\s\S]*?data-full-video-url=\{item.videoUrl\}/);
  assert.match(profileCarousel, /index === viewerIndex[\s\S]*?video\.play\(\)[\s\S]*?video\.pause\(\)/);
  assert.match(profileCarousel, /videoBufferMode\(index, viewerIndex, allowVideoWarmup, activeReady, video.hasAttribute\("src"\)\)/);
  assert.doesNotMatch(profileCarousel, /profile-media-playback-control|inlinePlaying|toggleInlinePlayback/);

  const tvRetryRule = tvFeed.match(/\.tv-playback-retry \{[\s\S]*?\}/)?.[0] || "";
  assert.match(tvRetryRule, /border: 1px solid rgba\(255,255,255,\.18\)/);
  assert.match(tvRetryRule, /background: rgba\(25,25,30,\.9\)/);
  assert.doesNotMatch(tvRetryRule, /126,234,255|34,199,255|124,58,237|109,40,217/);

  const tvRetryStateRule = aesthetic.match(
    /\.tv-shell \.tv-playback-retry:is\(:hover, :focus-visible, :active\) \{[\s\S]*?\}/,
  )?.[0] || "";
  assert.match(tvRetryStateRule, /border-color: var\(--dancr-color-white-medium\) !important;/);
  assert.match(tvRetryStateRule, /background-image: none !important;/);
  assert.doesNotMatch(tvRetryStateRule, /brand-primary|beam-violet|color-info/);

  assert.match(liveApp, /<link href="\/outputs\/dancr-aesthetic\.css" rel="stylesheet">/);
});
