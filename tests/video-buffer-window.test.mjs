import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { videoBufferMode } from "../src/lib/dancr/video-buffer-policy.ts";

const live = fs.readFileSync("outputs/index.html", "utf8");
const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const tv = fs.readFileSync("app/tv/TvFeedClient.tsx", "utf8").replace(/\r/g, "");
const routedStart = tv.indexOf("    const activeIndex = videos.findIndex");
const routedEnd = tv.indexOf("\n  }, [", routedStart);
assert.ok(routedStart > 0 && routedEnd > routedStart);
const routedBuffering = `function syncRoutedVideoLoading() {\n${tv.slice(routedStart, routedEnd)}\n}`;
const source = (name) => live.match(new RegExp("    (?:async )?function " + name + "\\([^]*?\\n    \\}"))?.[0];

test("profile and TV policies give startup priority, then prepare the previous and next clips for playback", () => {
  const context = vm.createContext({});
  vm.runInContext(source("videoBufferMode"), context);
  for (const active of [0, 1, 15, 29]) {
    for (const allowed of [false, true]) {
      for (const ready of [false, true]) {
        for (const attached of [false, true]) {
          for (let index = 0; index < 30; index++) {
            const expected = index === active ? "auto"
              : !allowed ? "release"
                : Math.abs(index - active) === 1 ? ready ? "auto" : attached ? "retain" : "release"
                  : "release";
            assert.equal(videoBufferMode(index, active, allowed, ready, attached), expected);
            assert.equal(context.videoBufferMode(index, active, allowed, ready, attached), expected);
          }
        }
      }
    }
  }
});

class Video {
  static HAVE_NOTHING = 0;
  static HAVE_CURRENT_DATA = 2;
  static NETWORK_EMPTY = 0;
  dataset = { videoUrl: "fixture.mp4" };
  attrs = new Map();
  preload = "none";
  readyState = 0;
  networkState = 0;
  resets = 0;
  assignments = 0;
  nextElementSibling = {
    attrs: new Map(),
    getAttribute(name) { return this.attrs.get(name); },
    setAttribute(name, value) { this.attrs.set(name, value); },
    removeAttribute(name) { this.attrs.delete(name); },
  };
  set src(url) { this.assignments++; this.attrs.set("src", url); this.networkState = 2; }
  hasAttribute(name) { return this.attrs.has(name); }
  getAttribute(name) { return this.attrs.get(name); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  removeAttribute(name) { this.attrs.delete(name); }
  pause() { this.paused = true; }
  load() { this.resets++; this.readyState = 0; this.networkState = this.hasAttribute("src") ? 2 : 0; }
}

for (const surface of ["profile", "tv", "routed-tv"]) {
  test(`${surface} scrolls keep warmed sources and decoded frames without restarting downloads`, () => {
    const videos = Array.from({ length: 30 }, () => new Video());
    videos.forEach((video, index) => {
      video.dataset.posterUrl = `poster-${index}.webp`;
      video.nextElementSibling.setAttribute("src", video.dataset.posterUrl);
    });
    const overlay = {
      dataset: {}, profileTvVideos: videos.map((_, i) => ({ posterUrl: `poster-${i}.webp` })),
      querySelectorAll: () => videos,
    };
    const slides = videos.map((video, index) => ({ dataset: { videoId: String(index) }, querySelector: () => video }));
    let warmup = true;
    const context = vm.createContext({
      HTMLVideoElement: Video, HTMLMediaElement: Video,
      document: { visibilityState: "visible" }, pageSuspendedVideos: new Set(),
      canWarmAdjacentVideo: () => warmup,
      profileVideoPosterUrl: (item) => item.posterUrl,
      results: { querySelectorAll: () => slides },
      videos: videos.map((_, index) => ({ id: String(index), videoUrl: `video-${index}.mp4` })),
      videoElements: { current: Object.fromEntries(videos.map((video, index) => [String(index), video])) },
      muted: true, engagedTimers: { current: {} },
      window: { setTimeout() {}, clearTimeout() {} },
      attemptVideoPlayback() {}, trackEvent() {},
    });
    vm.runInContext(["videoBufferMode", "applyVideoBufferMode", "attachDeferredVideoSource", "releaseDeferredVideoSource",
      "syncProfileTvVideoLoading", "primeHomeTvFeedNeighbors"].map(source).join("\n"), context);
    vm.runInContext(routedBuffering, context);
    const sync = (active, ready) => {
      overlay.dataset.loadedVideoIndex = ready ? String(active) : "";
      videos[active].readyState = ready ? 2 : 0;
      if (surface === "routed-tv") {
        context.activeVideoId = String(active);
        context.allowVideoWarmup = warmup;
        context.syncRoutedVideoLoading();
      } else if (surface === "profile") context.syncProfileTvVideoLoading(overlay, active);
      else {
        context.attachDeferredVideoSource(videos[active], "auto");
        context.primeHomeTvFeedNeighbors(String(active));
      }
    };
    sync(0, false);
    assert.equal(videos[1].hasAttribute("src"), false, "the next clip cannot compete with the first frame");
    sync(0, true);
    assert.equal(videos[1].preload, "auto", "prepare playable data instead of only metadata");
    videos[0].dataset.frameReady = "true";
    sync(1, true);
    assert.equal(videos[1].assignments, 1, "promote the same warmed video element");
    assert.equal(videos[0].resets, 0);
    assert.equal(videos[0].preload, "auto", "the previous clip is prepared for a backward swipe too");
    assert.equal(videos[0].dataset.frameReady, "true");
    const warmedNextResets = videos[1].resets;
    sync(0, false);
    assert.equal(videos[1].hasAttribute("src"), true, "a quick reversal keeps the attached neighbor while the active clip buffers");
    assert.equal(videos[1].preload, "none", "retention does not compete with active playback");
    assert.equal(videos[1].resets, warmedNextResets, "buffering must not reset the neighboring player");
    sync(0, true);
    assert.equal(videos[0].assignments, 1, "scrolling back reuses the existing buffer");
    assert.equal(videos[0].resets, 0);
    for (const active of [1, 2, 3, 18, 19, 18, 29, 0]) {
      sync(active, true);
      assert.ok(videos.filter((v) => v.hasAttribute("src")).length <= 3);
      videos.forEach((v, index) => {
        if (Math.abs(index - active) > 1) assert.equal(v.hasAttribute("src"), false);
        assert.equal(v.nextElementSibling.getAttribute("src"), `poster-${index}.webp`, "scrolling never clears an already available preview image");
        if (Math.abs(index - active) === 1) assert.equal(v.preload, "auto", "both directions have playable buffers");
      });
      const resets = videos.reduce((n, v) => n + v.resets, 0);
      sync(active, true);
      assert.equal(videos.reduce((n, v) => n + v.resets, 0), resets, "repeated readiness events do not reload players");
    }
    warmup = false;
    sync(0, true);
    assert.equal(videos.filter((v) => v.hasAttribute("src")).length, 1, "data saver releases all neighbors");
  });
}

test("buffer updates do not restart profile playback or discard TV buffers during activation", () => {
  const buffering = carousel.slice(carousel.indexOf('if (viewerKind !== "video") return;'), carousel.indexOf('}, [allowVideoWarmup, viewerVideoReadyVersion'));
  assert.doesNotMatch(buffering, /\.play\(/);
  assert.match(carousel, /\}, \[inlineMuted, setInlineMuted, viewerIndex, viewerKind\]\)/);
  assert.match(carousel, /if \(video.dataset.userPaused === "true"\) return/);
  assert.match(carousel, /if \(index === viewerIndex\) setViewerVideoReadyVersion\(\(version\) => version \+ 1\)/, "reopening the same video still signals a newly decoded frame");
  assert.doesNotMatch(source("activateHomeTvFeedVideo"), /releaseDeferredVideoSource/);
  assert.match(source("activateHomeTvFeedVideo"), /video.autoplay = false;\s*video.removeAttribute\("autoplay"\);\s*video.pause\(\)/);
  assert.match(source("activateHomeTvFeedVideo"), /\}\);\s*primeHomeTvFeedNeighbors\(videoId\)/);
  assert.match(source("setupHomeTvFeedObserver"), /visibleVideoId !== homeTvFeedActiveVideoId/);
});
