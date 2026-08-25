import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [profileTvStrip, liveApp] = await Promise.all([
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("profile videos have only thumbnail and fixed full-screen viewer sizes", () => {
  assert.match(profileTvStrip, /\.tv-strip-card \{[^}]*min-height: 330px/);
  assert.match(
    profileTvStrip,
    /\.tv-video-viewer \{[^}]*position: fixed;[^}]*inset: 0;[^}]*padding: 0;[^}]*touch-action: none;/,
  );
  assert.match(
    profileTvStrip,
    /\.tv-video-viewer-shell \{[^}]*width: 100%;[^}]*max-width: none;[^}]*height: 100%;[^}]*touch-action: none;/,
  );
  assert.match(profileTvStrip, /\.tv-video-viewer-stage \{[^}]*touch-action: none;/);
  assert.match(profileTvStrip, /controlsList="nofullscreen noremoteplayback nodownload"/);
  assert.match(profileTvStrip, /disablePictureInPicture/);
  assert.match(profileTvStrip, /<PlaybackStateIcon paused=\{viewerPaused\} \/>/);
  assert.match(profileTvStrip, /<SoundStateIcon muted=\{viewerMuted\} \/>/);
  assert.doesNotMatch(profileTvStrip, /\{viewerPaused \? "Play" : "Pause"\}/);
  assert.doesNotMatch(profileTvStrip, /\{viewerMuted \? "Sound on" : "Sound off"\}/);
  assert.doesNotMatch(profileTvStrip, /requestFullscreen|:fullscreen|enterDeviceFullscreen/);
});

test("live profile viewer blocks gesture enlargement but keeps horizontal video swiping", () => {
  assert.match(
    liveApp,
    /\.profile-tv-viewer \{[^}]*position: fixed;[^}]*inset: 0;[^}]*padding: 0;[^}]*touch-action: none;/,
  );
  assert.match(
    liveApp,
    /\.profile-tv-viewer-shell \{[^}]*width: 100%;[^}]*max-width: none;[^}]*height: 100%;[^}]*touch-action: none;/,
  );
  assert.match(liveApp, /id="profileTvViewerVideo" controlslist="nofullscreen noremoteplayback nodownload" disablepictureinpicture/);
  assert.match(liveApp, /data-toggle-profile-tv-playback aria-label="Pause TV video">\$\{modalVideoPlaybackIcon\(false\)\}/);
  assert.match(liveApp, /data-toggle-profile-tv-sound aria-label="Turn TV video sound off">\$\{modalVideoSoundIcon\(false\)\}/);
  assert.match(liveApp, /Math\.abs\(distance\) < 50\) return;[\s\S]*?showRelativeProfileTvVideo/);
  assert.match(
    liveApp,
    /async function requestProfileTvViewerFullscreen\(overlay\)[\s\S]*?overlay\.requestFullscreen\(\{ navigationUI: "hide" \}\)[\s\S]*?overlay\.webkitRequestFullscreen\(\)/,
  );
  assert.match(liveApp, /void requestProfileTvViewerFullscreen\(overlay\)[\s\S]*?renderProfileTvViewerItem/);
  assert.match(liveApp, /function exitProfileTvViewerFullscreen\(\)[\s\S]*?document\.exitFullscreen[\s\S]*?document\.webkitExitFullscreen/);
});

test("live profile sound and navigation controls are wired as top-level viewer actions", () => {
  const soundControls =
    liveApp.match(
      /function syncProfileTvSoundControl\(\)[\s\S]*?function toggleProfileTvPlayback\(\)/,
    )?.[0] || "";
  const viewerFactory =
    liveApp.match(
      /function profileTvViewer\(\)[\s\S]*?\n    function profileTvScheduleLabel/,
    )?.[0] || "";

  assert.match(
    soundControls,
    /function syncProfileTvSoundControl\(\) \{[\s\S]*?button\.innerHTML = modalVideoSoundIcon\(muted\);[\s\S]*?button\.setAttribute\("aria-label", muted \? "Turn TV video sound on" : "Turn TV video sound off"\);[\s\S]*?\n    \}/,
  );
  assert.match(
    soundControls,
    /function toggleProfileTvSound\(\) \{[\s\S]*?video\.muted = !video\.muted;[\s\S]*?syncProfileTvSoundControl\(\);[\s\S]*?\n    \}/,
  );
  assert.match(viewerFactory, /target\.closest\("\[data-toggle-profile-tv-sound\]"\)[\s\S]*?toggleProfileTvSound\(\)/);
  assert.match(viewerFactory, /stage\.addEventListener\("touchstart"[\s\S]*?stage\.addEventListener\("touchmove"[\s\S]*?stage\.addEventListener\("touchend"/);
  assert.doesNotMatch(
    soundControls,
    /function syncProfileTvSoundControl\(\) \{[\s\S]*?function toggleProfileTvSound\(\)[\s\S]*?if \(button\)/,
  );
});

test("live profile thumbnails use passive posters while the selected viewer owns playback", () => {
  const loader =
    liveApp.match(
      /async function loadProfileMyDancrTv\(profile\)[\s\S]*?\n    function formatProfileTvShift/,
    )?.[0] || "";

  assert.match(loader, /const videos = payload\.videos\.slice\(0, MAX_DANCER_PROFILE_VIDEOS\)/);
  assert.match(loader, /modalGallery\.profileTvVideos = videos/);
  assert.match(loader, /modalGallery\.dataset\.profileMediaProfile !== requestProfileId/);
  assert.match(loader, /appendNextProfileMediaBatch\("video"/);
  assert.match(liveApp, /function profileVideoThumbMarkup[\s\S]*?profileVideoPosterUrl\(item\)/);
  assert.doesNotMatch(loader, /createElement\("video"\)|video\.src = item\.videoUrl/);
  assert.match(liveApp, /function setModalVideo\(item, profileName, videos, index\)/);
  assert.match(
    liveApp,
    /function setModalVideo\(item, profileName, videos, index\)[\s\S]*?video\.autoplay = true[\s\S]*?video\.muted = modalProfileVideoMuted[\s\S]*?video\.setAttribute\("autoplay", ""\)[\s\S]*?preview\.appendChild\(video\)[\s\S]*?void video\.play\(\)\.catch/,
  );
  assert.doesNotMatch(liveApp, /modal-media-video-play/);
  assert.match(liveApp, /Tap the video to show or hide playback controls\. Use the full-screen button for immersive playback/);
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-modal-media-previous,[\s\S]*?width: 44px;[\s\S]*?border: 0;[\s\S]*?background: rgba\(0,0,0,\.06\);[\s\S]*?box-shadow: none;[\s\S]*?font-size: 22px;[\s\S]*?opacity: \.64;[\s\S]*?backdrop-filter: none/,
  );
  assert.match(
    liveApp,
    /\.profile-tv-viewer-previous,[\s\S]*?width: 44px;[\s\S]*?background: rgba\(0,0,0,\.06\);[\s\S]*?box-shadow: none;[\s\S]*?font-size: 22px;[\s\S]*?opacity: \.64;[\s\S]*?backdrop-filter: none/,
  );
  assert.match(
    liveApp,
    /\.profile-modal \.gallery \{[^}]*display: flex !important;[^}]*justify-content: flex-start !important;/,
  );
  assert.doesNotMatch(loader, /video\.autoplay = true/);
  assert.doesNotMatch(loader, /\.play\(\)/);
});
