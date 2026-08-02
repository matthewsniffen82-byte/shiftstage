import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);
const aesthetic = await readFile(
  new URL("../public/dancr-aesthetic.v1.css", import.meta.url),
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
    /<div class="modal-actions" aria-label="Customer actions">\s*\$\{goingButton\}/,
  );
  assert.match(
    liveApp,
    /class="action-btn follow-primary[\s\S]*?id="followBtn"/,
  );
  assert.match(liveApp, /id="notifyBtn"/);
  assert.match(liveApp, /id="goingBtn"/);
  assert.match(
    liveApp,
    /class="action-btn secondary profile-share-action"[\s\S]*?data-profile-share-menu=/,
  );
  assert.match(liveApp, /data-profile-more-actions aria-haspopup="menu" aria-expanded="false"/);
  assert.match(liveApp, /data-profile-more-menu role="menu" hidden/);
  assert.match(liveApp, /id="reportBtn" type="button" role="menuitem"/);
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.modal-actions \.going-btn \{\s*grid-column: 1 \/ -1 !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.modal-actions \.profile-share-action \{\s*grid-column: auto !important;/,
  );
});

test("home profile overlay mirrors the public profile information hierarchy", () => {
  const gridFunction = liveApp.match(
    /function profileModalGridMarkup\(profile, options = \{\}\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const dealIndex = gridFunction.indexOf("${dealMarkup}");
  const actionsIndex = gridFunction.indexOf("liveProfileModalActionsMarkup");
  const metricsIndex = gridFunction.indexOf("profileActivityMetricsMarkup");
  const socialIndex = gridFunction.indexOf("${socialMarkup}");
  const scheduleIndex = gridFunction.indexOf("shiftsMarkup");

  assert.ok(scheduleIndex > -1);
  assert.ok(dealIndex > scheduleIndex);
  assert.ok(actionsIndex > dealIndex);
  assert.ok(metricsIndex > actionsIndex);
  assert.ok(socialIndex > metricsIndex);
  assert.match(liveApp, /class="profile-modal-context" aria-live="polite">\s*<span class="pill" id="modalCity">Las Vegas<\/span>/);
  assert.doesNotMatch(liveApp, /id="modalShiftStatus"|id="modalShiftVenue"/);
  assert.match(liveApp, /modalCity\.hidden = false/);
  assert.match(
    liveApp,
    /class="info-tile profile-schedule-card schedule-upcoming">[\s\S]*?<div class="profile-schedule-primary">\$\{displayPublicShiftTime\(profile\.time, profile\)\}<\/div>/,
  );
});

test("home full-profile identity scrolls with the complete profile", () => {
  const identityRule = profilePolishBlock?.match(
    /#profileBackdrop \.profile-modal-summary \{[\s\S]*?\n        \}/,
  )?.[0] || "";

  assert.match(identityRule, /position: relative;/);
  assert.match(identityRule, /top: auto;/);
  assert.doesNotMatch(identityRule, /position: sticky;/);
});

test("home profile TV previews expose inline playback, sound, progress, and duration controls", () => {
  assert.match(liveApp, /id="modalVideoPlayback" type="button" aria-label="Play TV video"/);
  assert.match(liveApp, /id="modalVideoSound" type="button" aria-label="Turn TV video sound on"/);
  assert.match(liveApp, /id="modalVideoProgress" type="range"/);
  assert.match(liveApp, /function syncModalVideoControls\(\)/);
  assert.match(liveApp, /modalVideoProgress\?\.addEventListener\("input"/);
  assert.match(liveApp, /formatProfileTvDuration\(currentTime\)/);
});

test("profile overlay mobile geometry is shared by Android and iPhone", () => {
  assert.match(
    profilePolishBlock,
    /@media \(max-width: 520px\) \{[\s\S]*?#profileBackdrop \.profile-modal \{[\s\S]*?width: 100vw !important;[\s\S]*?padding-inline: 12px !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-summary \{[\s\S]*?grid-template-columns: 42px minmax\(0, 1fr\);[\s\S]*?min-height: 60px;[\s\S]*?margin-inline: -12px;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.modal-actions \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
  );
  assert.match(
    profilePolishBlock,
    /@media \(max-width: 720px\) \{[\s\S]*?#profileBackdrop \.modal-actions \{[\s\S]*?padding-bottom: 0 !important;[\s\S]*?#profileBackdrop \.modal-grid \{[\s\S]*?padding-bottom: var\(--profile-report-clearance\) !important;/,
  );
  assert.doesNotMatch(profilePolishBlock, /\.is-android|\.is-ios|SamsungBrowser|iPhone/);
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

test("mobile profile scrolling has no fixed rounded top-edge sliver", () => {
  const mobileProfileShellRule = aesthetic.match(
    /#profileBackdrop\.modal-backdrop\.show \.profile-modal \{[\s\S]*?\n  \}/,
  )?.[0] || "";

  assert.match(mobileProfileShellRule, /border-top-color: transparent !important;/);
  assert.match(mobileProfileShellRule, /border-top-left-radius: 0 !important;/);
  assert.match(mobileProfileShellRule, /border-top-right-radius: 0 !important;/);
  assert.match(mobileProfileShellRule, /box-shadow: none !important;/);
  assert.doesNotMatch(
    mobileProfileShellRule,
    /\b(?:overflow|touch-action|position|width|height|padding|margin)\b/,
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
    /#profileBackdrop #modalClose \{[\s\S]*?width: 42px !important;[\s\S]*?height: 42px !important;[\s\S]*?min-height: 42px !important;[\s\S]*?border-color: rgba\(180,169,196,\.2\) !important;/,
  );
});

test("profile identity and media controls form a compact balanced top section", () => {
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-summary \{[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\);[\s\S]*?min-height: 64px;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-avatar \{[\s\S]*?width: 44px;[\s\S]*?border: 1px solid rgba\(126,234,255,\.46\);/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop #modalCity \{[\s\S]*?min-height: 22px !important;[\s\S]*?border-radius: 999px !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-media-head span \{[\s\S]*?min-height: 24px;[\s\S]*?border-radius: 999px;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-media-tabs button \{[\s\S]*?min-height: 44px;/,
  );
});
