import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [tvFeed, profileTvStrip, publicProfileViewer, publicProfileStyles, liveApp] = await Promise.all([
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("MyDancr TV tap playback shows transient play and pause feedback", () => {
  assert.match(
    tvFeed,
    /function toggleVideoPlayback[\s\S]*?showPlaybackFeedback\(videoId, false\)[\s\S]*?element\.pause\(\);[\s\S]*?showPlaybackFeedback\(videoId, true\)/,
  );
  assert.match(tvFeed, /className="tv-playback-feedback"[\s\S]*?<PlaybackFeedbackIcon paused=\{playbackFeedback\.paused\}/);
  assert.match(tvFeed, /paused \? \([\s\S]*?<PlayIcon \/>[\s\S]*?M7 6h3v12H7zM14 6h3v12h-3z/);
  assert.match(tvFeed, /\.tv-playback-feedback \{[^}]*position: absolute;[^}]*border-radius: 50%;[^}]*pointer-events: none;/);
});

test("profile TV viewers show tap feedback without restoring a permanent playback action", () => {
  assert.match(
    profileTvStrip,
    /async function toggleViewerPlayback[\s\S]*?showPlaybackFeedback\(false\)[\s\S]*?video\.pause\(\);[\s\S]*?showPlaybackFeedback\(true\)/,
  );
  assert.match(profileTvStrip, /className="tv-video-playback-feedback"/);
  assert.match(profileTvStrip, /m9 7 8 5-8 5Z[\s\S]*?M7 6h3v12H7zM14 6h3v12h-3z/);
  assert.doesNotMatch(profileTvStrip, /PlaybackStateIcon|data-toggle-profile-tv-playback/);

  assert.match(liveApp, /function toggleModalVideoPlayback\(\)[\s\S]*?showModalVideoPlaybackFeedback\(false\)[\s\S]*?video\.pause\(\);[\s\S]*?showModalVideoPlaybackFeedback\(true\)/);
  assert.match(liveApp, /modalImage\?\.addEventListener\("click"[\s\S]*?toggleModalVideoPlayback\(\)/);
  assert.match(liveApp, /function toggleProfileTvPlayback\(\)[\s\S]*?showProfileTvPlaybackFeedback\(false\)[\s\S]*?video\.pause\(\);[\s\S]*?showProfileTvPlaybackFeedback\(true\)/);
  assert.match(liveApp, /class="profile-tv-playback-feedback" id="profileTvPlaybackFeedback"/);
  assert.doesNotMatch(liveApp, /data-toggle-profile-tv-playback/);
});

test("normal and expanded live TV views share the same play and pause feedback language", () => {
  assert.match(
    liveApp,
    /function toggleHomeTvFeedPlayback\(video\)[\s\S]*?showHomeTvFeedPlaybackFeedback\(slide, false\)[\s\S]*?video\.pause\(\);[\s\S]*?showHomeTvFeedPlaybackFeedback\(slide, true\)/,
  );
  assert.match(liveApp, /playback\.innerHTML = modalVideoPlaybackIcon\(true\)/);
  assert.match(liveApp, /\.home-tv-feed-playback\.show,[\s\S]*?opacity: 1;/);
  assert.match(liveApp, /function modalVideoPlaybackIcon\(paused\)[\s\S]*?m9 7 8 5-8 5Z[\s\S]*?M7 6h3v12H7zM14 6h3v12h-3z/);
});

test("public profile video feedback and share control remain native and circular", () => {
  assert.match(publicProfileViewer, /controls[\s\S]*?onPause=\{\(\) => handleViewerPlaybackChange\(index, true\)\}[\s\S]*?onPlay=\{\(\) => handleViewerPlaybackChange\(index, false\)\}/);
  assert.match(publicProfileViewer, /className="profile-media-playback-feedback"/);
  assert.match(publicProfileViewer, /className="profile-media-viewer-share"[\s\S]*?<ShareIcon \/>[\s\S]*?<\/button>/);
  assert.doesNotMatch(publicProfileViewer, /<ShareIcon \/>\s*Share/);
  assert.match(
    publicProfileStyles,
    /\.profile-media-viewer \.profile-media-viewer-share \{[^}]*width: 52px;[^}]*height: 52px;[^}]*border-radius: 50% !important;/,
  );
});
