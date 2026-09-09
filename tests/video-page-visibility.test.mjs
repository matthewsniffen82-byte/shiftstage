import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const shell = readFileSync("outputs/index.html", "utf8");
const source = name => shell.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0];
function fixture() {
  const videos = [true, false, false].map((active, index) => {
    const slide = { dataset: { videoId: String(index) }, getAttribute: () => slide.active ? "true" : null, active };
    return { slide, dataset: {}, isConnected: true, paused: !active, autoplay: active, preload: "auto", attrs: new Set(["src"]),
      closest: () => slide, hasAttribute(name) { return this.attrs.has(name); }, removeAttribute(name) { this.attrs.delete(name); }, pause() { this.paused = true; } };
  });
  const context = vm.createContext({
    pageSuspendedVideos: new Set(),
    document: { visibilityState: "hidden", querySelectorAll: () => videos, body: { classList: { contains: () => false } } },
    activeProfileTvViewerVideo: () => null,
    releaseDeferredVideoSource(video) { video.attrs.delete("src"); context.pageSuspendedVideos.delete(video); },
    activateHomeTvFeedVideo(id) { videos[Number(id)].paused = false; },
    playProfileTvViewerVideo(video) { video.paused = false; },
  });
  vm.runInContext(source("suspendPageVideoPlayback") + "\n" + source("resumePageVideoPlayback"), context);
  return { context, videos };
}

test("backgrounding pauses playback, releases neighbors, and resumes the same active element", () => {
  const { context, videos } = fixture();
  context.suspendPageVideoPlayback();
  assert.ok(videos.every(video => video.paused && video.preload === "none"));
  assert.equal(videos.filter(video => video.hasAttribute("src")).length, 1);
  context.suspendPageVideoPlayback(); // pagehide can follow visibilitychange
  context.resumePageVideoPlayback();
  assert.ok(videos.every(video => video.paused), "hidden pages cannot restart playback");
  context.document.visibilityState = "visible";
  context.resumePageVideoPlayback();
  assert.equal(videos[0].paused, false);
  assert.equal(context.pageSuspendedVideos.size, 0);
});

test("visibility restoration respects manual pauses, detached cards and a changed active card", () => {
  for (const state of ["manual", "detached", "inactive"]) {
    const { context, videos } = fixture();
    if (state === "manual") videos[0].paused = true;
    context.suspendPageVideoPlayback();
    if (state === "detached") videos[0].isConnected = false;
    if (state === "inactive") videos[0].slide.active = false;
    context.document.visibilityState = "visible";
    context.resumePageVideoPlayback();
    assert.ok(videos.every(video => video.paused), state);
    assert.equal(context.pageSuspendedVideos.size, 0);
  }
});

test("an open profile viewer takes playback priority over its underlying TV feed", () => {
  const { context, videos } = fixture();
  context.suspendPageVideoPlayback();
  context.document.body.classList.contains = () => true;
  context.document.visibilityState = "visible";
  context.resumePageVideoPlayback();
  assert.ok(videos.every(video => video.paused));
});

test("rapid backward jumps select a partially visible card and pause a feed outside the viewport", () => {
  const { videos } = fixture();
  const slides = videos.map(video => ({ ...video.slide, querySelector: () => video }));
  let callback;
  class Observer { constructor(fn) { callback = fn; } observe() {} disconnect() {} }
  const context = vm.createContext({
    homeTvFeedObserver: null, homeTvFeedActiveVideoId: "0", homeTvFeedIsImmersive: () => false,
    window: { IntersectionObserver: Observer }, IntersectionObserver: Observer,
    results: { querySelectorAll: () => slides },
    activateHomeTvFeedVideo(id) {
      context.homeTvFeedActiveVideoId = id;
      delete slides[Number(id)].dataset.viewportPaused;
      videos.forEach((video, index) => { video.paused = index !== Number(id); });
    },
    clearHomeTvFeedEngagedTimer() {}, primeHomeTvFeedNeighbors() {},
  });
  vm.runInContext(source("setupHomeTvFeedObserver"), context);
  context.setupHomeTvFeedObserver();
  const entry = (index, ratio) => ({ target: slides[index], intersectionRatio: ratio, isIntersecting: ratio > 0 });
  callback([entry(0, .8), entry(1, 0), entry(2, 0)]);
  callback([entry(0, 0), entry(2, .8)]);
  assert.equal(context.homeTvFeedActiveVideoId, "2");
  callback([entry(2, 0), entry(1, .6)]);
  assert.equal(context.homeTvFeedActiveVideoId, "1", "visible card wins even below the ordinary .72 snap threshold");
  callback([entry(1, 0)]);
  assert.ok(videos.every(video => video.paused));
  assert.equal(slides[1].dataset.viewportInactive, "true");
  callback([entry(1, .8)]);
  assert.equal(videos[1].paused, false);
  assert.equal(slides[1].dataset.viewportPaused, undefined);
});
