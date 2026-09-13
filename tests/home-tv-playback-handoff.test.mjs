import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const shell = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const activate = shell.match(/    function activateHomeTvFeedVideo\([^]*?\n    \}/)?.[0];

function fixture(activeIndex) {
  const starts = [], pending = [], primed = [], engaged = [];
  const videos = [0, 1, 2].map((index) => ({
    paused: index !== activeIndex, currentTime: 4 + index, autoplay: index === activeIndex,
    setAttribute() {}, removeAttribute() {},
    pause() { this.paused = true; },
    play() {
      starts.push({ index, othersPlaying: videos.filter((video) => video !== this && !video.paused).length });
      this.paused = false;
      return new Promise((resolve) => pending.push(resolve));
    },
  }));
  const slides = videos.map((video, index) => {
    const classes = new Set(index === activeIndex ? ["is-active"] : ["is-paused"]);
    return {
      dataset: { videoId: String(index) },
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      },
      querySelector: () => video, setAttribute() {}, removeAttribute() {},
    };
  });
  const context = vm.createContext({
    activeTab: "tv", homeTvFeedActiveVideoId: String(activeIndex), homeTvFeedMuted: true,
    homeTvFeedImpressions: new Set(), document: { visibilityState: "visible" },
    results: { querySelectorAll: () => slides },
    closeHomeTvFeedReportMenus() {}, attachDeferredVideoSource() {}, trackHomeTvFeedEvent() {},
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
