import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const shell = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const activate = shell.match(/    function activateHomeTvFeedVideo\([^]*?\n    \}/)?.[0];

function fixture(activeIndex, count = 3) {
  const starts = [], pending = [], primed = [], engaged = [];
  const videos = Array.from({ length: count }, (_, index) => ({
    paused: index !== activeIndex, currentTime: 4 + index, autoplay: index === activeIndex,
    pauses: 0, attrs: new Map(index === activeIndex ? [["autoplay", ""]] : []),
    hasAttribute(name) { return this.attrs.has(name); },
    setAttribute(name, value) { this.attrs.set(name, value); },
    removeAttribute(name) { this.attrs.delete(name); },
    pause() { this.paused = true; this.pauses++; },
    play() {
      starts.push({ index, othersPlaying: videos.filter((video) => video !== this && !video.paused).length });
      this.paused = false;
      return new Promise((resolve) => pending.push(resolve));
    },
  }));
  const slides = videos.map((video, index) => {
    const classes = new Set(index === activeIndex ? ["is-active"] : ["is-paused"]);
    const attrs = new Map(index === activeIndex ? [["aria-current", "true"]] : []);
    return {
      dataset: { videoId: String(index) },
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      },
      querySelector: () => video,
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute(name, value) { attrs.set(name, value); },
      removeAttribute(name) { attrs.delete(name); },
    };
  });
  const context = vm.createContext({
    activeTab: "tv", homeTvFeedActiveVideoId: String(activeIndex), homeTvFeedMuted: true,
    homeTvFeedImpressions: new Set(), document: { visibilityState: "visible" },
    homeTvFeedCoveredByProfile: () => false,
    results: { querySelectorAll: () => slides },
    closeHomeTvFeedReportMenus() {}, attachDeferredVideoSource() {}, trackHomeTvFeedEvent() {},
    hydrateHomeTvFeedSlide() {},
    clearHomeTvFeedEngagedTimer() {}, syncHomeTvFeedSoundButtons() {},
    primeHomeTvFeedNeighbors: (id) => primed.push(id),
    scheduleHomeTvFeedEngagedView: (id) => engaged.push(id),
  });
  vm.runInContext(activate, context);
  return { context, videos, slides, starts, primed, engaged,
    select: (index) => context.activateHomeTvFeedVideo(String(index)),
    settle: async () => { pending.splice(0).forEach((resolve) => resolve()); await Promise.resolve(); },
  };
}

test("TV scroll handoffs pause the outgoing clip before starting either neighbor", async () => {
  for (const [active, next] of [[0, 1], [1, 0], [2, 1], [2, 0]]) {
    const state = fixture(active);
    state.select(next);
    assert.deepEqual(state.starts, [{ index: next, othersPlaying: 0 }]);
    assert.deepEqual(state.videos.map((video) => video.paused), [0, 1, 2].map((index) => index !== next));
    assert.equal(state.videos[next].currentTime, 4 + next, "retained clips keep their playback position");
    await state.settle();
  }
});

test("rapid reversals ignore stale playback completions and warm only the final selected clip", async () => {
  const state = fixture(2);
  state.select(1);
  state.select(0);
  state.primed.length = 0;
  await state.settle();
  assert.ok(state.starts.every((start) => start.othersPlaying === 0));
  assert.deepEqual(state.primed, ["0"]);
  assert.deepEqual(state.engaged, ["0"]);
});

test("scrolling to a manually paused clip preserves the pause without leaving another clip playing", async () => {
  const state = fixture(2);
  state.slides[0].dataset.userPaused = "true";
  state.select(0);
  await state.settle();
  assert.deepEqual(state.starts, []);
  assert.ok(state.videos.every((video) => video.paused));
});

test("a stale viewport callback cannot restart the feed behind a full profile", async () => {
  const state = fixture(0);
  state.videos.forEach(video => video.pause());
  state.context.homeTvFeedCoveredByProfile = () => true;
  state.select(1);
  await state.settle();
  assert.deepEqual(state.starts, []);
  assert.deepEqual(state.primed, []);
});

test("a swipe leaves unrelated paused cards untouched even in a long feed", async () => {
  const state = fixture(12, 60);
  for (const [index, slide] of state.slides.entries()) {
    if (index === 12 || index === 13) continue;
    for (const name of ["add", "remove", "toggle"]) slide.classList[name] = () => assert.fail("unchanged cards must not be restyled");
    slide.setAttribute = slide.removeAttribute = () => assert.fail("unchanged cards must not be rewritten");
  }
  state.select(13);
  await state.settle();
  assert.equal(state.videos[12].pauses, 1);
  assert.ok(state.videos.every((video, index) => index === 12 || video.pauses === 0));
  assert.equal(state.slides[12].getAttribute("aria-current"), null);
  assert.equal(state.slides[13].getAttribute("aria-current"), "true");
  assert.deepEqual(state.starts, [{ index: 13, othersPlaying: 0 }]);
});
