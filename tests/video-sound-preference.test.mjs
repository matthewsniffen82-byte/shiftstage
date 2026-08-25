import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  route,
  browserController,
  preferenceHook,
  tvFeed,
  tvStrip,
  dancerCarousel,
] = await Promise.all([
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/video-sound-preference.js", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/use-video-sound-preference.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
]);

test("the live shell loads the shared sound preference controller before autoplay recovery", () => {
  assert.match(
    route,
    /video-sound-preference\.js\?v=1[\s\S]*video-autoplay-recovery\.js\?v=3/,
  );
});

test("video sound preference is browser-session scoped and defaults safely to muted", () => {
  assert.match(preferenceHook, /VIDEO_SOUND_PREFERENCE_KEY = "mydancr\.video-sound-muted\.v1"/);
  assert.match(preferenceHook, /sessionStorage\.getItem\(VIDEO_SOUND_PREFERENCE_KEY\)/);
  assert.match(preferenceHook, /return stored === "sound-on" \? false : true/);
  assert.match(preferenceHook, /sessionStorage\.setItem\([\s\S]*muted \? "muted" : "sound-on"/);
  assert.match(preferenceHook, /new CustomEvent\(VIDEO_SOUND_PREFERENCE_EVENT, \{ detail: \{ muted \} \}\)/);
});

test("the shell carries explicit sound choices across feed and profile video changes", () => {
  assert.match(browserController, /\.home-tv-feed-video/);
  assert.match(browserController, /\.modal-media-video-preview > video/);
  assert.match(browserController, /#profileTvViewerVideo/);
  assert.match(browserController, /document\.addEventListener\("play",[\s\S]*applyPreferenceToVideo\(video\)/);
  assert.match(browserController, /document\.addEventListener\("volumechange",[\s\S]*video\.muted === preferredMuted/);
  assert.match(browserController, /function syncHomeFeedState\(\)[\s\S]*button\.click\(\)/);
  assert.match(browserController, /new MutationObserver\([\s\S]*applyPreferenceToManagedVideos\(node\)/);
});

test("dedicated TV feed preserves user preference even if autoplay needs a muted retry", () => {
  assert.match(tvFeed, /const \[muted, setMuted\] = useVideoSoundPreference\(\)/);
  assert.match(tvFeed, /aria-label=\{muted \? "Turn sound on" : "Mute video"\}/);
  assert.match(tvFeed, /onClick=\{\(\) => setMuted\(\(value\) => !value\)\}/);
  assert.doesNotMatch(
    tvFeed,
    /if \(!element\.muted\) \{[\s\S]{0,160}(?:mutedRef\.current = true|setMuted\(true\))/,
  );
});

test("profile video surfaces share the same sound preference across selected videos", () => {
  assert.match(tvStrip, /const \[viewerMuted, setViewerMuted\] = useVideoSoundPreference\(\)/);
  assert.doesNotMatch(tvStrip, /setViewerMuted\(true\);[\s\S]{0,80}setActiveVideo\(video\)/);
  assert.match(dancerCarousel, /const \[inlineMuted, setInlineMuted\] = useVideoSoundPreference\(\)/);
  assert.equal((dancerCarousel.match(/muted=\{inlineMuted\}/g) || []).length, 3);
  assert.equal((dancerCarousel.match(/onVolumeChange=\{\(event\) =>/g) || []).length, 2);
});
