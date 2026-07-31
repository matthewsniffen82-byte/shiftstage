import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

const profilePolishBlock = liveApp.match(
  /\/\* Instagram-familiar dancer profile hierarchy; scoped away from global navigation\. \*\/[\s\S]*?\/\* Venue profiles keep X dismissal/,
)?.[0];

test("empty and upcoming schedules use one explanatory production card", () => {
  assert.match(
    liveApp,
    /if \(profile\.scheduled\) \{[\s\S]*?class="info-tile profile-schedule-card schedule-upcoming"[\s\S]*?This is the dancer's next posted shift\./,
  );
  assert.match(
    liveApp,
    /class="info-tile profile-schedule-card schedule-empty"[\s\S]*?<strong>Schedule<\/strong>[\s\S]*?No shift posted[\s\S]*?has not posted an upcoming shift yet\./,
  );
  assert.doesNotMatch(
    liveApp,
    /return `\s*<div class="info-tile">\s*<strong>Now<\/strong>[\s\S]*?<strong>Next shift<\/strong>[\s\S]*?No shift posted/,
  );
});

test("profile media is a compact horizontal filmstrip with stable geometry", () => {
  assert.ok(profilePolishBlock, "profile polish CSS block must exist");
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.gallery \{[\s\S]*?display: flex !important;[\s\S]*?overflow-x: auto !important;[\s\S]*?scroll-snap-type: x proximity !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.gallery \.thumb \{[\s\S]*?aspect-ratio: 4 \/ 5 !important;[\s\S]*?scroll-snap-align: start !important;/,
  );
  assert.match(profilePolishBlock, /overflow-anchor: none;/);
});

test("profile actions have a clear hierarchy and preserve every real action", () => {
  assert.match(
    liveApp,
    /class="action-btn follow-primary[\s\S]*?id="followBtn"/,
  );
  assert.match(liveApp, /id="notifyBtn"/);
  assert.match(liveApp, /id="goingBtn"/);
  assert.match(
    liveApp,
    /class="action-btn secondary profile-share-action"[\s\S]*?data-native-share=/,
  );
  assert.match(liveApp, /id="reportBtn"/);
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.modal-actions \.going-btn \{\s*grid-column: 1 \/ -1 !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.modal-actions \.profile-share-action \{\s*grid-column: 1 \/ -1 !important;/,
  );
});

test("profile-only polish does not restyle or reposition the bottom navigation", () => {
  assert.ok(profilePolishBlock, "profile polish CSS block must exist");
  assert.doesNotMatch(
    profilePolishBlock,
    /(?:^|\n)\s*(?:\.tabs|#homeMobileNav|\.global-mobile-bottom-nav|\.mobile-bottom-nav)\b/,
  );
  assert.match(
    profilePolishBlock,
    /Profile content clears the existing dock; the dock itself is intentionally untouched\./,
  );
});

test("the existing floating navigation clears the profile stacking context and is restored", () => {
  assert.match(
    liveApp,
    /const discoveryTabsHomeParent = discoveryTabs\?\.parentNode \|\| null;[\s\S]*?const discoveryTabsHomeNextSibling = discoveryTabs\?\.nextSibling \|\| null;/,
  );
  assert.match(
    liveApp,
    /function syncProfileDestinationNavigation\(\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)[\s\S]*?window\.matchMedia\("\(max-width: 720px\)"\)\.matches[\s\S]*?profileBackdrop\.parentNode\?\.insertBefore\(discoveryTabs, profileBackdrop\)[\s\S]*?discoveryTabsHomeParent\.insertBefore\(discoveryTabs, discoveryTabsHomeNextSibling\);/,
  );
  assert.match(
    liveApp,
    /function syncOverlayScrollLock\(\) \{[\s\S]*?syncProfileDestinationNavigation\(\);/,
  );
});

test("profile polish preserves the existing site color system", () => {
  assert.ok(profilePolishBlock, "profile polish CSS block must exist");
  assert.doesNotMatch(
    profilePolishBlock,
    /\.profile-schedule-card\.schedule-(?:upcoming|empty)/,
  );
  assert.doesNotMatch(
    profilePolishBlock,
    /\.modal-actions \.going-btn:not\(:disabled\)|\.modal-actions \.follow-primary,/
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop #modalClose \{\s*width: 46px !important;\s*height: 46px !important;\s*\}/,
  );
});
