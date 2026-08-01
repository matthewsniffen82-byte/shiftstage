import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [feedClient, videoStrip, rootRoute, homeRecovery] = await Promise.all([
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/video-autoplay-recovery.js", import.meta.url), "utf8"),
]);

test("MyDancr TV declares and retries muted autoplay for the active snap-scroll video", () => {
  assert.match(feedClient, /autoPlay=\{video\.id === activeVideoId\}/);
  assert.match(
    feedClient,
    /onCanPlay=\{\(event\) => \{[\s\S]*?attemptVideoPlayback\(video\.id, event\.currentTarget\)/,
  );
  assert.match(
    feedClient,
    /if \(!element\.muted\)[\s\S]*?setMuted\(true\)[\s\S]*?await element\.play\(\)/,
  );
  assert.match(
    feedClient,
    /document\.addEventListener\("visibilitychange", resumeActiveVideo\)[\s\S]*?window\.addEventListener\("pageshow", resumeActiveVideo\)/,
  );
  assert.match(feedClient, /className="tv-playback-retry"[\s\S]*?Tap to play/);
});

test("profile and venue video strips autoplay only their visible muted preview", () => {
  assert.match(
    videoStrip,
    /new IntersectionObserver\([\s\S]*?intersectionRatio[\s\S]*?playPreviewCard\(card\)/,
  );
  assert.match(
    videoStrip,
    /function playPreviewCard\(card: HTMLButtonElement\)[\s\S]*?video\.autoplay = active[\s\S]*?preview\.muted = true[\s\S]*?preview\.play\(\)/,
  );
  assert.match(videoStrip, /const \[viewerMuted, setViewerMuted\] = useState\(true\)/);
  assert.match(
    videoStrip,
    /onCanPlay=\{\(event\) => \{[\s\S]*?playViewerVideo\(event\.currentTarget\)/,
  );
});

test("the production home shell loads Safari-safe autoplay recovery for dynamically rendered videos", () => {
  assert.match(rootRoute, /script src="\/video-autoplay-recovery\.js\?v=3" defer/);
  assert.match(homeRecovery, /const HOME_FEED_VIDEO_SELECTOR = "\.home-tv-feed-video"/);
  assert.match(homeRecovery, /slide\.dataset\.userPaused === "true"/);
  assert.match(homeRecovery, /video\.defaultMuted = true/);
  assert.match(homeRecovery, /video\.setAttribute\("muted", ""\)/);
  assert.match(homeRecovery, /video\.setAttribute\("playsinline", ""\)/);
  assert.match(homeRecovery, /video\.setAttribute\("webkit-playsinline", ""\)/);
  assert.match(homeRecovery, /video\.addEventListener\("loadedmetadata"/);
  assert.match(homeRecovery, /video\.addEventListener\("canplay"/);
  assert.match(homeRecovery, /video\.addEventListener\("loadeddata"/);
  assert.match(homeRecovery, /new MutationObserver\(queueHomeFeedVideoScan\)/);
  assert.match(homeRecovery, /window\.addEventListener\("pageshow", queueHomeFeedVideoScan\)/);
});

test("the immersive TV feed reapplies iPhone inline autoplay requirements before playback", () => {
  assert.match(
    feedClient,
    /element\.autoplay = true[\s\S]*?element\.setAttribute\("autoplay", ""\)[\s\S]*?element\.playsInline = true[\s\S]*?element\.setAttribute\("webkit-playsinline", ""\)[\s\S]*?element\.defaultMuted = mutedRef\.current/,
  );
  assert.match(
    feedClient,
    /onLoadedMetadata=\{\(event\) => \{[\s\S]*?attemptVideoPlayback\(video\.id, event\.currentTarget\)/,
  );
});
