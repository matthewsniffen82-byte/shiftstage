import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const live = fs.readFileSync("outputs/index.html", "utf8");
const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const css = fs.readFileSync("public/profile-media-card-feed.css", "utf8");
const source = (name) => live.match(new RegExp("    (?:async )?function " + name + "\\([^]*?\\n    \\}"))?.[0];

test("every photo owns persistent controls with its own like, share, report, and navigation targets", () => {
  const controls = source("mountProfilePhotoCardControls");
  assert.match(controls, /cloneNode\(true\)/);
  assert.match(controls, /removeAttribute\("id"\)/);
  assert.match(controls, /scrollProfilePhotoViewerTo\(index - 1\)/);
  assert.match(controls, /scrollProfilePhotoViewerTo\(index \+ 1\)/);
  assert.match(controls, /togglePublicMediaLike\("photo", String\(item.id \|\| ""\), status\)/);
  assert.match(controls, /shareProfilePhoto\(index, status\)/);
  assert.match(controls, /targetType, targetId/);
  assert.doesNotMatch(source("syncProfilePhotoViewerPosition"), /mountProfileMediaCardControls/);
  assert.match(css, /#profilePhotoViewer\.profile-media-card-feed \[data-profile-photo-control-template\] \{\s*display: none !important/);
  assert.match(carousel, /\{renderViewerControls\(item, index\)\}\s*<\/section>/);
  assert.doesNotMatch(carousel, /createPortal|viewerControlsHost/);
  assert.match(carousel, /toggleMediaLike\(item.kind, item.id\)/);
  assert.match(carousel, /shareViewerItem\(item, index\)/);
  assert.match(carousel, /openMediaReport\(item, index\)/);
});

test("upcoming video posters remain visible independently of native iOS video loading", () => {
  assert.match(source("renderProfileTvViewerSlides"), /createElement\("img"\)/);
  assert.match(source("renderProfileTvViewerSlides"), /poster.loading = "eager"/);
  assert.match(carousel, /className="profile-media-video-poster"[^]*?loading="eager"[^]*?src=\{Math.abs\(index - viewerIndex\) <= 2 \? item.posterUrl : undefined\}/);
  assert.match(css, /video\[data-frame-ready="true"\] \+ .profile-media-video-poster/);
  assert.match(css, /\.profile-media-video-poster \{[^}]*z-index: 2 !important;[^}]*pointer-events: none/);
  assert.match(carousel, /onEmptied=\{\(event\) => \{ delete event.currentTarget.dataset.frameReady; \}\}/);
});

test("video poster windows stay bounded and work with adjacent video warmup disabled", () => {
  const videos = Array.from({ length: 30 }, () => ({
    dataset: {}, poster: "", source: false, preload: "none",
    hasAttribute(name) { return name === "src" && this.source; },
    removeAttribute(name) { if (name === "poster") this.poster = ""; },
    nextElementSibling: {
      src: null,
      getAttribute() { return this.src; },
      setAttribute(name, value) { if (name === "src") this.src = value; },
      removeAttribute() { this.src = null; },
    },
  }));
  const overlay = {
    dataset: {},
    profileTvVideos: videos.map((_, i) => ({ posterUrl: `poster-${i}.jpg` })),
    querySelectorAll: () => videos,
  };
  const context = vm.createContext({
    profileVideoPosterUrl: (item) => item.posterUrl,
    document: { visibilityState: "visible" },
    canWarmAdjacentVideo: () => false,
    attachDeferredVideoSource: (video, preload) => { video.source = true; video.preload = preload; },
    releaseDeferredVideoSource: (video) => { video.source = false; video.preload = "none"; },
  });
  vm.runInContext(["videoBufferMode", "applyVideoBufferMode", "syncProfileTvVideoLoading"].map(source).join("\n"), context);
  for (const active of [0, 1, 12, 28, 12, 0]) {
    context.syncProfileTvVideoLoading(overlay, active);
    videos.forEach((video, index) => {
      assert.equal(Boolean(video.nextElementSibling.src), Math.abs(index - active) <= 2);
      assert.equal(video.source, index === active, "previews do not force background video downloads");
    });
  }
});

test("sound-on autoplay denial retries muted without reviving a stale video", async () => {
  let current;
  let attempts = 0;
  let syncs = 0;
  const status = { textContent: "" };
  const video = { muted: false, async play() { attempts++; if (!this.muted) throw { name: "NotAllowedError" }; } };
  current = video;
  const context = vm.createContext({
    activeProfileTvViewerVideo: () => current,
    syncProfileTvSoundControl: () => { syncs++; },
    document: { getElementById: () => status },
  });
  vm.runInContext(source("playProfileTvViewerVideo"), context);
  await context.playProfileTvViewerVideo(video);
  assert.equal(attempts, 2);
  assert.equal(video.muted, true);
  assert.equal(syncs, 1);
  assert.equal(status.textContent, "");
  video.muted = false;
  current = null;
  await context.playProfileTvViewerVideo(video);
  assert.equal(attempts, 3, "do not retry after scrolling away");
  current = video;
  video.play = async () => { throw { name: "NotAllowedError" }; };
  await context.playProfileTvViewerVideo(video);
  assert.equal(status.textContent, "Tap the video to start it.");
});
