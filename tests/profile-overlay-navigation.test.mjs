import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync("outputs/index.html", "utf8");

test("mobile navigation cannot cover the fixed profile video viewer", () => {
  assert.match(
    homeSource,
    /body\.profile-tv-viewer-open #discoveryTabs,\s+body\.profile-photo-viewer-open #discoveryTabs \{\s+visibility: hidden !important;\s+pointer-events: none !important;\s+\}/,
  );
  assert.match(
    homeSource,
    /function openProfileTvViewer[\s\S]*?document\.body\.classList\.add\("profile-tv-viewer-open"\)/,
  );
  assert.match(
    homeSource,
    /function closeProfileTvViewer[\s\S]*?document\.body\.classList\.remove\("profile-tv-viewer-open"\)/,
  );
  assert.match(
    homeSource,
    /const overlayOpen = !!document\.querySelector\("\.page-panel\.show, \.modal-backdrop\.show,[^"]+"\);[\s\S]*?document\.body\.classList\.toggle\("overlay-open", overlayOpen\);/,
  );
  assert.match(
    homeSource,
    /<button class="profile-modal-report-link" id="reportBtn" type="button" aria-label="Report profile">Report<\/button>/,
  );
  assert.doesNotMatch(homeSource, /profileActionOverflowToggle|profileActionOverflowMenu|<button class="profile-report-action" id="reportBtn"/);
});

test("mobile navigation cannot cover the fixed profile photo viewer", () => {
  assert.match(
    homeSource,
    /body\.profile-tv-viewer-open #discoveryTabs,\s+body\.profile-photo-viewer-open #discoveryTabs \{\s+visibility: hidden !important;\s+pointer-events: none !important;\s+\}/,
  );
  assert.match(homeSource, /document\.body\.appendChild\(profilePhotoViewer\)/);
  assert.match(
    homeSource,
    /function openPhotoViewerFromElement[\s\S]*?document\.body\.classList\.add\("profile-photo-viewer-open"\);\s+syncOverlayScrollLock\(\)/,
  );
  assert.match(
    homeSource,
    /function closeProfilePhotoViewer[\s\S]*?document\.body\.classList\.remove\("profile-photo-viewer-open"\);\s+syncOverlayScrollLock\(\)/,
  );
  assert.match(
    homeSource,
    /\.profile-photo-viewer \{[\s\S]*?inset: 0;[\s\S]*?position: fixed;[\s\S]*?\.profile-photo-viewer-image \{[\s\S]*?height: 100dvh;[\s\S]*?width: 100vw;/,
  );
});
