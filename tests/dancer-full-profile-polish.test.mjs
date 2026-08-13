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
  const shiftsFunction = liveApp.match(
    /function shiftsMarkup\(profile, status = shiftStatus\(profile\), options = \{\}\) \{[\s\S]*?function profileActivityMetricsMarkup/,
  )?.[0] || "";
  const liveScheduleBranch = shiftsFunction.split("if (profile.scheduled)")[0];
  assert.match(liveScheduleBranch, /profile-schedule-card working-now-tile schedule-live/);
  assert.doesNotMatch(liveScheduleBranch, /Next shift|No next shift posted|shiftNotesMarkup/);
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

test("full dancer profiles use a quiet neutral vertical scrollbar", () => {
  const profileScrollbarThumb = profilePolishBlock?.match(
    /#profileBackdrop \.profile-modal::\-webkit-scrollbar-thumb \{[\s\S]*?\}/,
  )?.[0] || "";
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal \{[\s\S]*?scrollbar-width: thin;[\s\S]*?scrollbar-color: rgba\(255,255,255,\.28\) transparent;/,
  );
  assert.match(
    profileScrollbarThumb,
    /background: rgba\(255,255,255,\.28\);[\s\S]*?box-shadow: none;/,
  );
  assert.doesNotMatch(
    profileScrollbarThumb,
    /rgba\((?:109,40,217|139,92,246)/,
  );
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
  assert.ok(socialIndex > actionsIndex);
  assert.ok(metricsIndex > socialIndex);
  assert.match(liveApp, /class="profile-modal-context" aria-live="polite">\s*<span class="pill" id="modalCity">Las Vegas<\/span>/);
  assert.match(liveApp, /data-working-now-indicator aria-hidden="true">NOW<\/span>/);
  assert.doesNotMatch(liveApp, /profile-modal-live-status|modalLiveStatus/);
  assert.doesNotMatch(liveApp, /id="modalShiftStatus"|id="modalShiftVenue"/);
  assert.match(liveApp, /modalCity\.hidden = false/);
  assert.match(
    liveApp,
    /class="info-tile profile-schedule-card schedule-upcoming">[\s\S]*?<div class="profile-schedule-primary">\$\{displayPublicShiftTime\(profile\.time, profile\)\}<\/div>/,
  );
});

test("home full-profile identity scrolls naturally on desktop and mobile", () => {
  const identityRule = profilePolishBlock?.match(
    /#profileBackdrop \.profile-modal-summary \{[\s\S]*?\n        \}/,
  )?.[0] || "";

  assert.match(identityRule, /position: relative;/);
  assert.match(identityRule, /top: auto;/);
  assert.doesNotMatch(identityRule, /position: sticky;/);
  assert.match(
    profilePolishBlock,
    /@media \(max-width: 720px\) \{[\s\S]*?#profileBackdrop\.modal-backdrop\.show \{[\s\S]*?overflow-y: hidden !important;[\s\S]*?Let the dancer identity and close control leave the viewport[\s\S]*?#profileBackdrop \.profile-modal-summary \{[\s\S]*?position: relative !important;[\s\S]*?top: auto !important;[\s\S]*?z-index: 1;/,
  );
  assert.doesNotMatch(
    profilePolishBlock,
    /@media \(max-width: 720px\) \{[\s\S]*?#profileBackdrop \.profile-modal-summary \{[\s\S]*?position: sticky !important;/,
  );
});

test("the full-profile verified badge stays circular like scroll-card checks", () => {
  const verifiedBadgeRule = profilePolishBlock?.match(
    /#profileBackdrop \.profile-modal-verified \{[\s\S]*?\n        \}/,
  )?.[0] || "";

  assert.match(verifiedBadgeRule, /width: 19px;/);
  assert.match(verifiedBadgeRule, /height: 19px;/);
  assert.match(verifiedBadgeRule, /min-width: 19px;/);
  assert.match(verifiedBadgeRule, /min-height: 19px;/);
  assert.match(verifiedBadgeRule, /flex: 0 0 19px;/);
  assert.match(verifiedBadgeRule, /aspect-ratio: 1;/);
  assert.match(verifiedBadgeRule, /border-radius: 50%;/);
});

test("home profile TV previews expose inline playback, sound, progress, and duration controls", () => {
  assert.match(liveApp, /id="modalVideoPlayback" type="button" aria-label="Play TV video"[^>]*>[\s\S]*?profile-modal-media-control-icon/);
  assert.match(liveApp, /id="modalVideoSound" type="button" aria-label="Turn TV video sound on"[^>]*>[\s\S]*?profile-modal-media-control-icon/);
  assert.match(liveApp, /id="modalVideoProgress" type="range"/);
  assert.match(liveApp, /function syncModalVideoControls\(\)/);
  assert.match(liveApp, /modalVideoProgress\?\.addEventListener\("input"/);
  assert.match(liveApp, /formatProfileTvDuration\(currentTime\)/);
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-modal-video-controls \{[\s\S]*?grid-template-columns: 36px 36px minmax\(64px, 1fr\) auto;[\s\S]*?border-radius: 999px;[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/,
  );
  assert.match(liveApp, /#profileBackdrop \.profile-modal-video-controls\.is-visible,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
  assert.match(liveApp, /#profileBackdrop \.profile-modal-video-controls button \{[\s\S]*?border-radius: 50% !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(liveApp, /#profileBackdrop \.profile-modal-media-expand \{[\s\S]*?border-radius: 50% !important;[\s\S]*?background: rgba\(12,12,20,\.72\) !important;/);
  assert.match(liveApp, /--profile-video-progress[\s\S]*?::-webkit-slider-runnable-track[\s\S]*?height: 3px;/);
  assert.match(liveApp, /function setModalVideoControlsVisible\(visible, options = \{\}\)[\s\S]*?window\.setTimeout[\s\S]*?1800/);
  assert.match(liveApp, /modalImage\?\.addEventListener\("click"[\s\S]*?modalImage\.dataset\.activeMediaType === "video"[\s\S]*?setModalVideoControlsVisible/);
  assert.doesNotMatch(liveApp, /id="modalVideoPlayback"[^>]*>\s*Play\s*<\/button>/);
  assert.doesNotMatch(liveApp, /id="modalVideoSound"[^>]*>\s*Sound on\s*<\/button>/);
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
    /#profileBackdrop #modalClose \{[\s\S]*?width: 42px !important;[\s\S]*?height: 42px !important;[\s\S]*?min-height: 42px !important;[\s\S]*?border-color: rgba\(180,169,196,\.2\) !important;[\s\S]*?box-shadow: none !important;/,
  );
});

test("profile identity and media controls form a compact balanced top section", () => {
  assert.match(
    liveApp,
    /<div class="profile-modal-summary">[\s\S]*?<button class="close-btn" id="modalClose" type="button" aria-label="Close profile">/,
  );
  assert.doesNotMatch(liveApp, /<div class="modal-top">\s*<button class="close-btn" id="modalClose"/);
  assert.match(
    liveApp,
    /#profileBackdrop #modalClose \{[\s\S]*?position: absolute !important;[\s\S]*?top: 8px !important;[\s\S]*?transform: none !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-summary \{[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\);[\s\S]*?min-height: 64px;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-avatar \{[\s\S]*?width: 44px;[\s\S]*?border: 1px solid rgba\(126,234,255,\.46\);[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop #modalCity \{[\s\S]*?min-height: 22px !important;[\s\S]*?border-radius: 999px !important;/,
  );
  assert.match(profilePolishBlock, /#profileBackdrop \.profile-modal-summary \{[\s\S]*?border-bottom: 0;/);
  assert.doesNotMatch(liveApp, /profileModalMediaTitle|profileModalMediaCount|profile-modal-media-head/);
  assert.match(liveApp, /<section class="profile-modal-media" aria-label="Dancer profile media">\s*<div class="profile-modal-media-tabs"/);
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-modal-media-tabs \{[\s\S]*?grid-template-columns: repeat\(2, 44px\);[\s\S]*?gap: 0;[\s\S]*?padding: 0;[\s\S]*?border: 0;/,
  );
  assert.match(
    profilePolishBlock,
    /body\.dancr-button-system #profileBackdrop \.profile-modal-media-tabs button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-radius: 50% !important;/,
  );
  assert.match(profilePolishBlock, /body\.dancr-button-system #profileBackdrop \.profile-modal-media-tabs button::before \{[\s\S]*?inset: 4px;[\s\S]*?border-radius: 50%;/);
  assert.match(profilePolishBlock, /#profileBackdrop \.profile-media-tab-icon \{[\s\S]*?width: 18px;[\s\S]*?height: 18px;/);
});

test("Working Now profiles do not repeat the Club Confirmed check-in card", () => {
  assert.match(
    liveApp,
    /function profileLocationStatusTile\(profile, city = selectedCity\(\)\) \{\s+if \(isWorkingTonight\(profile, city\)\) return "";/,
  );
  assert.match(liveApp, /\$\{profileLocationStatusTile\(profile, city\)\}/);
});

test("unavailable profile QR stays visible in a compact square tile", () => {
  const unavailableDealMarkup = liveApp.match(
    /const unavailableLabel = state\.key === "no-active-offer"[\s\S]*?(?=\n    function profileShareText)/,
  )?.[0] || "";
  assert.match(unavailableDealMarkup, /"Available when dancer is working"/);
  assert.match(unavailableDealMarkup, /state\.key === "no-active-offer"/);
  assert.match(unavailableDealMarkup, /<span class="profile-deal-label">Club Deal<\/span>/);
  assert.match(unavailableDealMarkup, /clubDealQrSymbolMarkup\("profile-deal-placeholder"\)/);
  assert.doesNotMatch(unavailableDealMarkup, /How Club Deals work|profile-deal-disclosure|profile-deal-note/);
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-qr-unavailable \{[\s\S]*?width: min\(168px, 100%\) !important;[\s\S]*?min-height: 168px !important;[\s\S]*?aspect-ratio: 1 \/ 1;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?justify-self: center !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-deal-placeholder \{[\s\S]*?width: 72px !important;[\s\S]*?min-width: 72px !important;[\s\S]*?height: 72px !important;[\s\S]*?justify-self: center !important;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-deal-placeholder \{[\s\S]*?border-color: rgba\(148,163,184,\.14\) !important;[\s\S]*?color: rgba\(148,163,184,\.58\) !important;[\s\S]*?box-shadow: none !important;[\s\S]*?opacity: \.62;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop \.profile-qr-unavailable::before,[\s\S]*?#profileBackdrop \.profile-qr-unavailable::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;[\s\S]*?background: none !important;[\s\S]*?box-shadow: none !important;/,
  );
});
