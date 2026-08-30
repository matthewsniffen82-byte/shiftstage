import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [profileTvStrip, liveApp, aestheticCss, buttonCss] = await Promise.all([
  readFile(new URL("../app/components/TvVideoStrip.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-button-system.v1.css", import.meta.url), "utf8"),
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
  assert.match(profileTvStrip, /<SoundStateIcon muted=\{viewerMuted\} \/>/);
  assert.doesNotMatch(profileTvStrip, /PlaybackStateIcon|aria-label=\{viewerPaused \? "Play video" : "Pause video"\}/);
  assert.doesNotMatch(profileTvStrip, /\{viewerPaused \? "Play" : "Pause"\}/);
  assert.doesNotMatch(profileTvStrip, /\{viewerMuted \? "Sound on" : "Sound off"\}/);
  assert.doesNotMatch(profileTvStrip, /requestFullscreen|:fullscreen|enterDeviceFullscreen/);
});

test("live profile viewer mirrors MyDancr TV with vertical profile-only video paging", () => {
  assert.match(
    liveApp,
    /\.profile-tv-viewer \{[^}]*position: fixed;[^}]*inset: 0;[^}]*padding: 0;[^}]*touch-action: none;/,
  );
  assert.match(
    liveApp,
    /\.profile-tv-viewer-shell \{[^}]*width: 100%;[^}]*max-width: none;[^}]*height: 100%;[^}]*touch-action: none;/,
  );
  assert.match(
    liveApp,
    /\.profile-tv-viewer-stage \{[^}]*overflow-y: auto;[^}]*scroll-snap-type: y mandatory;[^}]*touch-action: pan-y;/,
  );
  assert.match(
    liveApp,
    /\.profile-tv-viewer-slide \{[^}]*height: 100%;[^}]*min-height: 100%;[^}]*scroll-snap-align: start;[^}]*scroll-snap-stop: always;/,
  );
  assert.match(liveApp, /video\.setAttribute\("controlslist", "nofullscreen noremoteplayback nodownload"\)/);
  assert.match(liveApp, /video\.setAttribute\("disablepictureinpicture", ""\)/);
  assert.match(liveApp, /data-toggle-profile-tv-sound aria-label="Turn TV video sound off">\$\{modalVideoSoundIcon\(false\)\}/);
  assert.doesNotMatch(liveApp, /data-toggle-profile-tv-playback/);
  assert.match(liveApp, /stage\.addEventListener\("scroll"[\s\S]*?profileTvViewerScrollTarget\([\s\S]*?renderProfileTvViewerItem\(target\.index, \{ scroll: false \}\)/);
  assert.match(liveApp, /function renderProfileTvViewerSlides[\s\S]*?profile-tv-viewer-slide[\s\S]*?stage\.appendChild\(slide\)/);
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
    /function toggleProfileTvSound\(\) \{[\s\S]*?profileTvViewerMuted = !video\.muted;[\s\S]*?viewerVideo\.muted = profileTvViewerMuted;[\s\S]*?syncProfileTvSoundControl\(\);[\s\S]*?\n    \}/,
  );
  assert.match(viewerFactory, /target\.closest\("\[data-toggle-profile-tv-sound\]"\)[\s\S]*?toggleProfileTvSound\(\)/);
  assert.match(viewerFactory, /stage\.addEventListener\("scroll"[\s\S]*?requestAnimationFrame/);
  assert.doesNotMatch(
    soundControls,
    /function syncProfileTvSoundControl\(\) \{[\s\S]*?function toggleProfileTvSound\(\)[\s\S]*?if \(button\)/,
  );
});

test("dancer profile viewers reuse translucent TV glass without adding controls", () => {
  const liveViewerActions = liveApp.match(
    /<div class="profile-tv-viewer-actions">[\s\S]*?<\/div>/,
  )?.[0] || "";
  const sharedTvGlass = aestheticCss.match(
    /\/\* TV utility controls remain neutral[\s\S]*?(?=\/\* Active applause)/,
  )?.[0] || "";
  const quietMediaPaging = buttonCss.match(
    /\/\* Media paging stays visually quiet[\s\S]*?(?=\.dancr-button-system :is\(\s*\.profile-modal-media-previous,[\s\S]*?:disabled)/,
  )?.[0] || "";

  assert.match(sharedTvGlass, /\.home-tv-feed-action:not\(\.home-tv-feed-deal-action\)/);
  for (const selector of [
    ".profile-tv-viewer-close",
    ".profile-tv-viewer-previous",
    ".profile-tv-viewer-next",
    ".profile-tv-viewer-actions button",
    ".tv-video-viewer-close",
    ".tv-video-viewer-previous",
    ".tv-video-viewer-next",
    ".tv-video-viewer-actions button",
  ]) {
    assert.match(sharedTvGlass, new RegExp(selector.replaceAll(".", "\\.")));
  }
  assert.match(sharedTvGlass, /background-color: var\(--dancr-color-black-soft\) !important;/);
  assert.match(sharedTvGlass, /backdrop-filter: blur\(14px\) saturate\(1\.08\) !important;/);
  assert.doesNotMatch(quietMediaPaging, /profile-tv-viewer-(?:previous|next)/);

  assert.match(
    profileTvStrip,
    /\.tv-video-viewer-close \{[^}]*background-color: rgba\(5,5,10,\.5\);[^}]*background-image: linear-gradient\(155deg,[^}]*backdrop-filter: blur\(14px\) saturate\(1\.12\);/,
  );
  assert.match(profileTvStrip, /className="tv-video-viewer-close"[\s\S]*?<svg aria-hidden="true" viewBox="0 0 24 24">/);
  assert.match(
    profileTvStrip,
    /\.tv-video-viewer-actions button \{[^}]*background-color: rgba\(5,5,10,\.5\);[^}]*backdrop-filter: blur\(14px\) saturate\(1\.12\);/,
  );
  assert.equal((profileTvStrip.match(/className="tv-video-viewer-state-control"/g) || []).length, 1);
  assert.equal((profileTvStrip.match(/className="tv-video-viewer-share"/g) || []).length, 1);
  assert.match(profileTvStrip, /aria-label="Share this profile video"[\s\S]*?onClick=\{\(\) => shareVideo\(activeVideo\)\}[\s\S]*?<ShareIcon \/>/);
  assert.match(profileTvStrip, /\.tv-video-viewer-actions \{[^}]*grid-template-columns: repeat\(2, 52px\)/);
  assert.match(
    profileTvStrip,
    /\.tv-video-viewer-actions button \{[^}]*width: 52px;[^}]*height: 52px;[^}]*border-radius: 50% !important;/,
  );

  assert.match(
    liveApp,
    /\.profile-tv-viewer-close \{[^}]*background-color: rgba\(5,5,10,\.5\);[^}]*backdrop-filter: blur\(14px\) saturate\(1\.12\);/,
  );
  assert.match(liveApp, /data-close-profile-tv aria-label="Close full-screen video">\$\{actionIconMarkup\("close"\)\}<\/button>/);
  assert.match(
    liveApp,
    /\.profile-tv-viewer-actions button \{[^}]*background-color: rgba\(5,5,10,\.5\);[^}]*backdrop-filter: blur\(14px\) saturate\(1\.12\);/,
  );
  assert.equal((liveViewerActions.match(/<button/g) || []).length, 2);
  assert.doesNotMatch(liveViewerActions, /data-toggle-profile-tv-playback/);
  assert.match(liveViewerActions, /data-toggle-profile-tv-sound/);
  assert.match(liveViewerActions, /class="profile-tv-viewer-share"[^>]*data-share-profile-tv/);
  assert.match(
    liveApp,
    /\.profile-tv-viewer-actions button \{[^}]*width: 52px !important;[^}]*height: 52px !important;[^}]*border-radius: 50% !important;/,
  );
});

test("profile grid thumbnails stay passive while the full viewer has no thumbnail strip", () => {
  const loader =
    liveApp.match(
      /async function loadProfileMyDancrTv\(profile\)[\s\S]*?\n    function formatProfileTvShift/,
    )?.[0] || "";

  assert.match(loader, /const videos = payload\.videos\.slice\(0, MAX_DANCER_PROFILE_VIDEOS\)/);
  assert.match(loader, /modalGallery\.profileTvVideos = videos/);
  assert.match(loader, /modalGallery\.dataset\.profileMediaProfile !== requestProfileId/);
  assert.match(loader, /appendNextProfileMediaBatch\("video"/);
  assert.match(liveApp, /function profileVideoThumbMarkup[\s\S]*?profileVideoPosterUrl\(item\)/);
  assert.match(liveApp, /muted playsinline preload="none" tabindex="-1"/);
  assert.doesNotMatch(liveApp, /function profileVideoPreviewUrl\(item\)/);
  assert.doesNotMatch(loader, /createElement\("video"\)|video\.src = item\.videoUrl/);
  assert.match(liveApp, /function setModalVideo\(item, profileName, videos, index\)/);
  assert.match(
    liveApp,
    /function setModalVideo\(item, profileName, videos, index\)[\s\S]*?video\.autoplay = true[\s\S]*?video\.muted = modalProfileVideoMuted[\s\S]*?video\.setAttribute\("autoplay", ""\)[\s\S]*?preview\.appendChild\(video\)[\s\S]*?void video\.play\(\)\.catch/,
  );
  assert.doesNotMatch(liveApp, /modal-media-video-play/);
  assert.match(liveApp, /Tap the video to play or pause\. Use the full-screen button for immersive playback/);
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-modal-media-previous,[\s\S]*?width: 44px;[\s\S]*?border: 0;[\s\S]*?background: rgba\(0,0,0,\.06\);[\s\S]*?box-shadow: none;[\s\S]*?font-size: 22px;[\s\S]*?opacity: \.64;[\s\S]*?backdrop-filter: none/,
  );
  assert.match(liveApp, /\.profile-tv-viewer-actions \{[^}]*position: absolute;[^}]*right: max\(12px, env\(safe-area-inset-right\)\);[^}]*grid-template-columns: 52px;/);
  assert.doesNotMatch(liveApp, /profile-tv-viewer-gallery|profileTvViewerGallery|data-profile-tv-index[^\n]*aria-current/);
  assert.match(
    liveApp,
    /\.profile-modal \.gallery \{[^}]*display: flex !important;[^}]*justify-content: flex-start !important;/,
  );
  assert.doesNotMatch(loader, /video\.autoplay = true/);
  assert.doesNotMatch(loader, /\.play\(\)/);
});
