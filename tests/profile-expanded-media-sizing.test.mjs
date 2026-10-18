import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const live = fs.readFileSync("outputs/index.html", "utf8");
const react = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const liveFunction = (name) => live.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))[0];
const reactSizing = ts.transpileModule(
  react.match(/function sizeProfileMediaCard\([^]*?\n\}/)[0],
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
).outputText;

function fixture(source) {
  const context = vm.createContext({});
  vm.runInContext(source === "live" ? liveFunction("sizeProfileMediaCard") : reactSizing, context);
  const values = new Map();
  const anchor = { offsetTop: 700 };
  const feed = {
    scrollTop: 760,
    querySelectorAll: () => [slide, anchor],
    scrollTo({ top, behavior }) { this.scrollTop = top; this.behavior = behavior; },
  };
  const slide = {
    offsetTop: 0,
    dataset: {},
    closest: () => feed,
    style: {
      getPropertyValue: (key) => values.get(key),
      setProperty(key, value) {
        values.set(key, value);
        // Model a card above the viewport becoming 300px shorter on metadata load.
        anchor.offsetTop = 400;
      },
    },
  };
  const media = source === "live" ? slide : { closest: () => slide };
  return {
    slide, feed, values,
    size: (width, height, kind) => context.sizeProfileMediaCard(media, width, height, kind),
  };
}

for (const source of ["live", "react"]) {
  test(`${source}: natural proportions resize the frame without shifting the visible card`, () => {
    const { size, values, feed, slide } = fixture(source);
    size(900, 1200);
    assert.equal(values.get("--profile-media-card-ratio"), "900 / 1200");
    assert.equal(slide.dataset.mediaControls, "overlay");
    assert.equal(feed.scrollTop, 460);
    assert.equal(feed.behavior, "instant");
    // At 390px wide, this photo needs 520px, not a fixed viewport-height box.
    const [width, height] = values.get("--profile-media-card-ratio").split(" / ").map(Number);
    assert.equal(390 * height / width, 520);
    size(900, 1200);
    assert.equal(feed.scrollTop, 460, "repeated loads must not move the feed again");
    size(1600, 900);
    assert.equal(slide.dataset.mediaControls, "below", "wide media retains accessible controls");
  });

  test(`${source}: video metadata replaces a poster estimate and later poster loads cannot undo it`, () => {
    const { size, values, slide } = fixture(source);
    size(400, 400, "poster");
    size(1080, 1920, "video");
    size(400, 400, "poster");
    assert.equal(values.get("--profile-media-card-ratio"), "1080 / 1920");
    assert.equal(slide.dataset.mediaRatioSource, "video");
    assert.equal(slide.dataset.mediaControls, "overlay");
    size(0, 0, "video");
    size(Infinity, 1920, "video");
    size(1080, -1, "video");
    assert.equal(values.get("--profile-media-card-ratio"), "1080 / 1920", "unloaded media retains its last valid dimensions");
  });
}

test("a short final video can become active even when it cannot reach the top of the viewport", () => {
  const context = vm.createContext({});
  vm.runInContext(["profileMediaCardScrollIndex", "profileTvViewerScrollTarget"].map(liveFunction).join("\n"), context);
  const result = context.profileTvViewerScrollTarget(undefined, 630, 700, [0, 800, 1100], 0, 1330);
  assert.equal(result.index, 2);
  assert.equal(result.locked, false);
  assert.equal(context.profileTvViewerScrollTarget("1", 630, 700, [0, 800, 1100], 0, 1330).index, 1);
  assert.match(react, /scrollTop \+ feed.clientHeight >= feed.scrollHeight - 1\) return slides.length - 1/);
});
