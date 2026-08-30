import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, aestheticCss] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

const profileMediaGlass = aestheticCss.match(
  /\/\* Profile photo and video overlays share one visibly translucent glass[\s\S]*$/,
)?.[0] || "";

test("profile photo overlay controls use circular translucent glass", () => {
  for (const selector of [
    ".profile-photo-viewer-close",
    ".profile-photo-viewer-previous",
    ".profile-photo-viewer-next",
    ".profile-photo-viewer-like",
    ".profile-photo-viewer-share",
  ]) {
    assert.match(profileMediaGlass, new RegExp(selector.replaceAll(".", "\\.")));
  }

  assert.match(profileMediaGlass, /border-radius: 50% !important;/);
  assert.match(profileMediaGlass, /background-color: rgba\(18, 18, 28, 0\.38\) !important;/);
  assert.match(profileMediaGlass, /background-image: linear-gradient\(/);
  assert.match(profileMediaGlass, /-webkit-backdrop-filter: blur\(16px\) saturate\(1\.18\) !important;/);
  assert.match(profileMediaGlass, /backdrop-filter: blur\(16px\) saturate\(1\.18\) !important;/);
  assert.doesNotMatch(profileMediaGlass, /background-image: none|dancr-color-black-(?:soft|medium)/);
  assert.match(
    profileMediaGlass,
    /\.profile-photo-viewer-close \{[\s\S]*?width: 44px !important;[\s\S]*?height: 44px !important;/,
  );

  assert.match(
    liveShell,
    /\.profile-photo-viewer-share,[\s\S]*?\.profile-photo-viewer-like \{[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?border-radius: 50% !important;/,
  );
});

test("profile video sound controls keep the shared glass material on iPhone", () => {
  assert.match(profileMediaGlass, /\.profile-tv-viewer-actions button/);
  assert.match(
    profileMediaGlass,
    /#profileBackdrop \.profile-modal-video-controls #modalVideoSound/,
  );
  assert.match(
    liveShell,
    /class="profile-tv-viewer-state-control"[^>]*data-toggle-profile-tv-sound/,
  );
});
