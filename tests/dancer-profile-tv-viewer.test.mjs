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
  assert.match(profileTvStrip, /\{viewerPaused \? "Play" : "Pause"\}/);
  assert.match(profileTvStrip, /\{viewerMuted \? "Sound on" : "Sound off"\}/);
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
  assert.match(liveApp, /data-toggle-profile-tv-playback>Pause/);
  assert.match(liveApp, /data-toggle-profile-tv-sound>Sound off/);
  assert.match(liveApp, /Math\.abs\(distance\) < 50\) return;[\s\S]*?showRelativeProfileTvVideo/);
  assert.doesNotMatch(liveApp, /data-fullscreen-profile-tv|enterProfileTvFullscreen|requestFullscreen\(\)/);
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
    /function syncProfileTvSoundControl\(\) \{[\s\S]*?if \(button\) button\.textContent = video\?\.muted \? "Sound on" : "Sound off";[\s\S]*?\n    \}/,
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

test("live profile TV cards adapt to content and avoid background autoplay storms", () => {
  const loader =
    liveApp.match(
      /async function loadProfileMyDancrTv\(profile\)[\s\S]*?\n    function formatProfileTvShift/,
    )?.[0] || "";

  assert.match(liveApp, /\.profile-tv-strip \{[^}]*width: fit-content;[^}]*max-width: 100%/);
  assert.match(liveApp, /\.profile-tv-strip\[data-video-count="1"\][^}]*grid-auto-columns/);
  assert.match(liveApp, /\.profile-tv-strip\[data-video-count="2"\][^}]*grid-auto-columns/);
  assert.match(loader, /section\.dataset\.videoCount = String\(Math\.min\(payload\.videos\.length, 4\)\)/);
  assert.match(loader, /profile-tv-strip-count/);
  assert.match(loader, /video \$\{index \+ 1\} of \$\{payload\.videos\.length\} full screen/);
  assert.match(loader, /if \(firstPreview\) observeProfileTvPreview\(section, firstPreview\)/);
  assert.doesNotMatch(loader, /video\.autoplay = true/);
});
