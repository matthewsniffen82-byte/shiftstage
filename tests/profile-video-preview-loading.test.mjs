import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const shell = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const carousel = await readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8");
const start = shell.indexOf("    function profileVideoPosterUrl(item)");
const end = shell.indexOf("    function profileMediaSentinel", start);
assert.ok(start > 0 && end > start);
const context = vm.createContext({
  escapeHtml: (value) => String(value).replaceAll('"', "&quot;"),
  profileTvScheduleLabel: () => "No shift posted",
});
vm.runInContext(shell.slice(start, end), context);

test("first two video preview rows load before the hidden Videos tab is opened", () => {
  for (let index = 0; index < 12; index += 1) {
    const markup = context.profileVideoThumbMarkup({ posterUrl: "https://example.com/poster.webp" }, index, 12, "Dancer");
    assert.match(markup, new RegExp(`loading="${index < 6 ? "eager" : "lazy"}"`));
    assert.match(markup, /fetchpriority="low"/);
    assert.doesNotMatch(markup, /<video/);
  }
});

test("missing posters retain their playable placeholder without an empty image request", () => {
  const markup = context.profileVideoThumbMarkup({}, 0, 1, "Dancer");
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /data-profile-tv-index="0"/);
  assert.match(markup, /profile-media-thumb-play/);
});

test("direct profiles preload only the first six poster images across media tabs", () => {
  assert.match(carousel, /videoMedia\.slice\(0, 6\)\.forEach/);
  assert.match(carousel, /if \(video\.posterUrl\) preload\(video\.posterUrl, \{ as: "image", fetchPriority: "low" \}\)/);
  assert.match(carousel, /loading=\{index < 6 \? "eager" : "lazy"\}/);
});
