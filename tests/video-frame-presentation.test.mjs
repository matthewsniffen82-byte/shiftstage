import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const helper = readFileSync("src/lib/dancr/video-frame-presentation.mjs", "utf8");
const live = readFileSync("outputs/index.html", "utf8");
const liveHelper = live.match(/    function observeVideoPresentation\([^]*?\n    \}/)?.[0];
assert.ok(liveHelper);
const sources = {
  routed: helper.replace("export function", "function"),
  live: liveHelper,
};

function harness(source, { frameCallbacks = true } = {}) {
  let id = 0;
  const frames = new Map();
  const paints = new Map();
  const listeners = new Map();
  const video = {
    dataset: {}, paused: true, seeking: false, readyState: 0, isConnected: true,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
    requestVideoFrameCallback: frameCallbacks ? (callback) => { frames.set(++id, callback); return id; } : undefined,
    cancelVideoFrameCallback: (key) => frames.delete(key),
  };
  const context = vm.createContext({ window: {
    requestAnimationFrame(callback) { paints.set(++id, callback); return id; },
    cancelAnimationFrame(key) { paints.delete(key); },
  } });
  vm.runInContext(source, context);
  const cleanup = context.observeVideoPresentation(video);
  const emit = (name) => listeners.get(name)?.();
  const flush = (queue) => {
    const callbacks = [...queue.values()];
    queue.clear();
    callbacks.forEach((callback) => callback());
  };
  const play = () => { video.paused = false; video.readyState = 2; emit("playing"); };
  return { video, frames, paints, listeners, cleanup, emit, play,
    frame: () => flush(frames), paint: () => flush(paints) };
}

test("live and routed players use the same presentation observer", () => {
  const normalize = (value) => value.replace(/\r/g, "").trim();
  assert.equal(normalize(liveHelper.replace(/^    /gm, "")),
    normalize(helper.slice(helper.indexOf("export function")).replace("export function", "function")));
});

for (const [surface, source] of Object.entries(sources)) {
  test(`${surface}: decoded data and play requests cannot expose an unpainted player`, () => {
    const h = harness(source);
    h.video.readyState = 2;
    for (const event of ["loadedmetadata", "loadeddata", "canplay", "play"]) h.emit(event);
    assert.equal(h.video.dataset.frameReady, undefined);
    assert.equal(h.frames.size, 0, "warming a paused neighbor keeps its poster");
    h.play();
    h.emit("timeupdate");
    h.emit("playing");
    assert.equal(h.frames.size, 1, "readiness events do not stack callbacks");
    h.paint();
    h.paint();
    assert.equal(h.video.dataset.frameReady, undefined, "paints alone cannot bypass the video callback");
    h.frame();
    h.paint();
    assert.equal(h.video.dataset.frameReady, undefined, "keep the cover through the first paint opportunity");
    h.paint();
    assert.equal(h.video.dataset.frameReady, "true");
    h.emit("timeupdate");
    assert.equal(h.frames.size, 0, "stop observing once the player has been revealed");
    h.video.paused = true;
    h.emit("pause");
    h.emit("waiting");
    assert.equal(h.video.dataset.frameReady, "true", "retain the displayed frame on pause or buffering");
  });

  test(`${surface}: fast scrolling cancels stale frames and re-arms on playback`, () => {
    const h = harness(source);
    h.play();
    const staleFrame = [...h.frames.values()][0];
    h.video.paused = true;
    h.emit("pause");
    assert.equal(h.frames.size, 0);
    staleFrame();
    assert.equal(h.paints.size, 0);
    h.play();
    h.frame();
    const stalePaint = [...h.paints.values()][0];
    h.emit("emptied");
    h.play();
    stalePaint();
    assert.equal(h.paints.size, 0, "an old source cannot reveal a replacement source");
    h.frame();
    h.paint();
    h.paint();
    assert.equal(h.video.dataset.frameReady, "true");
    h.emit("loadstart");
    assert.equal(h.video.dataset.frameReady, undefined);
  });

  test(`${surface}: browsers without frame callbacks wait for playback and paint`, () => {
    const h = harness(source, { frameCallbacks: false });
    h.video.readyState = 2;
    h.emit("loadeddata");
    h.paint();
    h.paint();
    assert.equal(h.video.dataset.frameReady, undefined);
    h.play();
    h.paint();
    assert.equal(h.video.dataset.frameReady, undefined);
    h.paint();
    assert.equal(h.video.dataset.frameReady, "true");
  });

  test(`${surface}: returning to a paused buffered player waits for its new display frame`, () => {
    const h = harness(source);
    h.play(); h.frame(); h.paint(); h.paint();
    h.video.paused = true;
    h.emit("pause");
    assert.equal(h.video.dataset.frameReady, "true", "manual pause retains the current frame");
    h.video.paused = false;
    h.emit("play");
    assert.equal(h.video.dataset.frameReady, undefined, "resume cannot reuse a stale presentation marker");
    h.emit("playing");
    assert.equal(h.frames.size, 1);
    h.frame(); h.paint(); h.paint();
    assert.equal(h.video.dataset.frameReady, "true");
  });

  test(`${surface}: errors and disposal cancel callbacks without affecting another player`, () => {
    for (const stop of ["error", "cleanup"]) {
      for (const phase of ["frame", "paint"]) {
        const h = harness(source);
        const other = harness(source);
        h.play();
        other.play();
        if (phase === "paint") h.frame();
        if (stop === "cleanup") h.cleanup();
        else h.emit(stop);
        assert.equal(h.frames.size + h.paints.size, 0);
        h.frame(); h.paint(); h.paint();
        assert.equal(h.video.dataset.frameReady, undefined);
        if (stop === "cleanup") assert.equal(h.listeners.size, 0);
        other.frame(); other.paint(); other.paint();
        assert.equal(other.video.dataset.frameReady, "true");
      }
    }
  });

  test(`${surface}: a detached, seeking or stalled player keeps its cover`, () => {
    for (const change of [{ isConnected: false }, { seeking: true }, { readyState: 1 }]) {
      const h = harness(source);
      h.play();
      h.frame();
      Object.assign(h.video, change);
      h.paint(); h.paint();
      assert.equal(h.video.dataset.frameReady, undefined);
    }
  });
}

test("all scrolling players attach presentation observers and keep a poster above the video", () => {
  const profile = readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  const resourceRef = readFileSync("src/lib/dancr/video-resource-ref.ts", "utf8");
  const tv = readFileSync("app/tv/TvFeedClient.tsx", "utf8");
  assert.match(profile, /ref=\{videoResourceRef\}/);
  assert.match(resourceRef, /observeVideoPresentation\(video\)/);
  assert.match(resourceRef, /stopPresentation\(\)/);
  assert.doesNotMatch(profile, /dataset\.frameReady = "true"/);
  assert.match(tv, /\.map\(videoResourceRef\)/);
  assert.match(tv, /video\[data-frame-ready="true"\] \+ \.tv-video-poster/);
  assert.match(live, /video\.addEventListener\("emptied"[^]*?observeVideoPresentation\(video\);\s*slide\.appendChild\(video\)/);
  assert.match(live, /video\.dataset\.posterUrl = posterUrl;[^]*?observeVideoPresentation\(video\)/);
  assert.match(live, /fallback,\s*video,\s*poster,/);
  assert.match(live, /\.home-tv-feed-video\[data-frame-ready="true"\] \+ \.home-tv-feed-video-poster/);
  const css = readFileSync("public/profile-media-card-feed.css", "utf8");
  assert.match(css, /\[aria-current="true"\] > video\[data-frame-ready="true"\]/);
  assert.match(tv, /\.tv-slide\[aria-current="true"\] video\[data-frame-ready="true"\]/);
  assert.match(live, /\.home-tv-feed-slide\[aria-current="true"\] \.home-tv-feed-video\[data-frame-ready="true"\]/);
});
