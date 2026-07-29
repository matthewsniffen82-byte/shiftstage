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
  assert.match(liveApp, /Math\.abs\(distance\) >= 50[\s\S]*?showRelativeProfileTvVideo/);
  assert.doesNotMatch(liveApp, /data-fullscreen-profile-tv|enterProfileTvFullscreen|requestFullscreen\(\)/);
});
