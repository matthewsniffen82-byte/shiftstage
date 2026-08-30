import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canWarmAdjacentVideo } from "../src/lib/dancr/use-adaptive-video-warmup.ts";

const [profileCarousel, tvFeed, videoStrip, liveShell, dashboard, dancerStudio, tvService] =
  await Promise.all([
    "../app/dancers/[slug]/DancerPhotoCarousel.tsx",
    "../app/tv/TvFeedClient.tsx",
    "../app/components/TvVideoStrip.tsx",
    "../outputs/index.html",
    "../app/dashboard/DashboardClient.tsx",
    "../app/dashboard/DancerTvStudio.tsx",
    "../src/lib/dancr/tv.ts",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));

test("adjacent video warm-up respects data saver and constrained connections", () => {
  assert.equal(canWarmAdjacentVideo(null), true);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "4g" } }), true);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "3g" } }), true);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "2g" } }), false);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "SLOW-2G" } }), false);
  assert.equal(canWarmAdjacentVideo({ connection: { effectiveType: "4g", saveData: true } }), false);
  assert.equal(canWarmAdjacentVideo({ mozConnection: { effectiveType: "2g" } }), false);
  assert.equal(canWarmAdjacentVideo({ webkitConnection: { saveData: true } }), false);
});

test("routed profile grids remain poster-only and the viewer loads a bounded forward window", () => {
  const grid = profileCarousel.slice(
    profileCarousel.indexOf("{visibleItems.map"),
    profileCarousel.indexOf("{viewer && activeViewerItem"),
  );
  const gridVideo = grid.match(/<video[\s\S]*?\/>/)?.[0] || "";
  assert.match(gridVideo, /poster=\{item\.posterUrl \|\| undefined\}/);
  assert.match(gridVideo, /preload="none"/);
  assert.doesNotMatch(gridVideo, /src=\{/);

  assert.match(profileCarousel, /const \[loadedViewerVideoIndex, setLoadedViewerVideoIndex\] = useState\(-1\)/);
  assert.match(profileCarousel, /index === viewerIndex[\s\S]*?\? "auto"[\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? "metadata"[\s\S]*?: "none"/);
  assert.match(profileCarousel, /src=\{index === viewerIndex \|\| \([\s\S]*?loadedViewerVideoIndex === viewerIndex[\s\S]*?index === viewerIndex \+ 1[\s\S]*?\? item\.videoUrl : undefined\}/);
  assert.match(profileCarousel, /if \(!video\.hasAttribute\("src"\)\) video\.load\(\)/);
});

test("routed TV feed starts with one source and warms only the immediate next item", () => {
  assert.match(tvFeed, /const primeNextVideo[\s\S]*?setWarmAfterVideoId\(videoId\)/);
  assert.match(tvFeed, /const shouldWarm = allowVideoWarmup[\s\S]*?videoIndex === activeIndex \+ 1/);
  assert.match(tvFeed, /element\.preload = isActive \? "auto" : shouldWarm \? "metadata" : "none"/);
  assert.match(tvFeed, /src=\{video\.id === activeVideoId \|\| \([\s\S]*?videoIndex === activeVideoIndex \+ 1[\s\S]*?\? video\.videoUrl : undefined\}/);
  assert.match(tvFeed, /onLoadedData=\{[\s\S]*?primeNextVideo\(video\.id\)/);
  assert.doesNotMatch(tvFeed, /Math\.abs\(videoIndex - activeIndex\) <= 1/);
});

test("profile strips attach previews on intent and release inactive media resources", () => {
  assert.match(videoStrip, /data-video-url=\{video\.videoUrl\}[\s\S]*?poster=\{video\.posterUrl \|\| undefined\}[\s\S]*?preload="none"/);
  assert.match(videoStrip, /function playPreviewCard[\s\S]*?preview\.src = videoUrl[\s\S]*?preview\.preload = "auto"/);
  assert.match(videoStrip, /function releasePreviewVideo[\s\S]*?video\.pause\(\)[\s\S]*?video\.preload = "none"[\s\S]*?video\.removeAttribute\("src"\)[\s\S]*?video\.load\(\)/);
  assert.match(videoStrip, /viewerReadyVideoId === activeVideo\.id && index === activeIndex \+ 1 \? "metadata" : "none"/);
  assert.match(videoStrip, /viewerReadyVideoId === activeVideo\.id && index === activeIndex \+ 1 \? video\.videoUrl : undefined/);
});

test("live shell defers home and full-profile video sources beyond the active window", () => {
  assert.match(liveShell, /function attachDeferredVideoSource[\s\S]*?video\.dataset\.videoUrl[\s\S]*?if \(!video\.hasAttribute\("src"\)\) video\.src = videoUrl/);
  assert.match(liveShell, /function releaseDeferredVideoSource[\s\S]*?video\.removeAttribute\("src"\)[\s\S]*?video\.load\(\)/);
  assert.match(liveShell, /function primeHomeTvFeedNeighbors[\s\S]*?index === activeIndex \+ 1[\s\S]*?attachDeferredVideoSource\(video, "metadata"\)[\s\S]*?releaseDeferredVideoSource\(video\)/);
  assert.match(liveShell, /video\.dataset\.videoUrl = String\(item\.videoUrl \|\| ""\)\.trim\(\)[\s\S]*?if \(index === 0\) attachDeferredVideoSource\(video, "auto"\)/);

  assert.match(liveShell, /function syncProfileTvVideoLoading[\s\S]*?activeReady && canWarmAdjacentVideo\(\)[\s\S]*?index === activeIndex \+ 1[\s\S]*?attachDeferredVideoSource\(video, "metadata"\)[\s\S]*?releaseDeferredVideoSource\(video\)/);
  assert.match(liveShell, /video\.className = "profile-tv-viewer-video"[\s\S]*?video\.dataset\.videoUrl[\s\S]*?video\.preload = "none"/);
  assert.doesNotMatch(liveShell, /video\.className = "profile-tv-viewer-video"[\s\S]{0,500}?video\.src = item\.videoUrl/);
});

test("saved dashboard videos reuse generated posters without initializing preview players", () => {
  assert.match(tvService, /moderation_details, dancer_profiles/);
  assert.match(tvService, /function mapManagedVideo[\s\S]*?normalizedVideoPosterStoragePath\(video\)[\s\S]*?posterUrl:/);
  assert.match(dashboard, /poster=\{video\.posterUrl \|\| undefined\}[\s\S]*?preload="none"/);
  assert.doesNotMatch(dashboard, /primeVideoPreviewFrame/);
  assert.match(dancerStudio, /poster=\{video\.posterUrl \|\| undefined\}[\s\S]*?preload="none"[\s\S]*?src=\{video\.videoUrl\}/);
});
