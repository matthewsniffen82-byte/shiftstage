import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileCarousel = await readFile(
  new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url),
  "utf8",
);
const profilePage = await readFile(
  new URL("../app/dancers/[slug]/page.tsx", import.meta.url),
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

test("visible video play and pause controls stay neutral in every interaction state", () => {
  assert.match(
    profileCarousel,
    /aria-label=\{inlinePlaying \? "Pause TV video" : "Play TV video"\}[\s\S]*?className="profile-media-playback-control"/,
  );

  const profilePlaybackRule = profilePage.match(
    /\.profile-media-playback-control:is\(:hover, :focus-visible, :active\) \{[\s\S]*?\}/,
  )?.[0] || "";
  assert.match(profilePlaybackRule, /border-color: rgba\(255,255,255,\.18\) !important;/);
  assert.match(profilePlaybackRule, /background: rgba\(25,25,30,\.9\) !important;/);
  assert.match(profilePlaybackRule, /background-image: none !important;/);
  assert.doesNotMatch(profilePlaybackRule, /126,234,255|34,199,255|124,58,237|109,40,217/);

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

  assert.match(liveApp, /dancr-aesthetic\.v1\.css\?v=128/);
});
