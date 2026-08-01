import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync("outputs/index.html", "utf8");

test("mobile navigation cannot cover the fixed profile video viewer", () => {
  assert.match(
    homeSource,
    /body\.profile-tv-viewer-open #discoveryTabs(?:,\s+body\.profile-tv-viewer-open #homeTvDrawer)? \{\s+visibility: hidden !important;\s+pointer-events: none !important;\s+\}/,
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
    /data-profile-more-menu role="menu" hidden>[\s\S]*?<button id="reportBtn" type="button" role="menuitem"[^>]*>Report profile<\/button>/,
  );
});
