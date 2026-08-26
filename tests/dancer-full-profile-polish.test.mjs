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

test("empty schedules collapse to one status line while upcoming schedules retain their destination", () => {
  assert.match(
    liveApp,
    /if \(profile\.scheduled\) \{[\s\S]*?class="info-tile profile-schedule-card profile-shift-card schedule-upcoming"[\s\S]*?This is the dancer's next posted shift\./,
  );
  assert.match(
    liveApp,
    /const emptyScheduleCopy =[\s\S]*?`Follow \$\{escapeHtml\(profile\.name\)\} for updates`;[\s\S]*?class="info-tile profile-schedule-card profile-shift-card schedule-empty" aria-label="Schedule status">[\s\S]*?class="profile-schedule-inline">[\s\S]*?<strong>No shift posted<\/strong>[\s\S]*?\$\{emptyScheduleCopy\}/,
  );
  assert.doesNotMatch(
    liveApp,
    /return `\s*<div class="info-tile">\s*<strong>Now<\/strong>[\s\S]*?<strong>Next shift<\/strong>[\s\S]*?No shift posted/,
  );
  assert.match(
    liveApp,
    /No-shift profiles should communicate the state[\s\S]*?\.profile-schedule-card\.schedule-empty \{[\s\S]*?display: block !important;[\s\S]*?min-height: 0 !important;[\s\S]*?padding: 8px 10px !important;[\s\S]*?\.profile-schedule-inline \{[\s\S]*?display: flex !important;/,
  );
  const shiftsFunction = liveApp.match(
    /function shiftsMarkup\(profile, status = shiftStatus\(profile\), options = \{\}\) \{[\s\S]*?function profileActivityMetricsMarkup/,
  )?.[0] || "";
  const liveScheduleBranch = shiftsFunction.split("if (profile.scheduled)")[0];
  assert.match(liveScheduleBranch, /profile-schedule-card profile-shift-card working-now-tile schedule-live/);
  assert.doesNotMatch(liveScheduleBranch, /Next shift|No next shift posted|shiftNotesMarkup/);
});

test("current and upcoming schedules share one compact venue destination", () => {
  assert.match(
    liveApp,
    /function profileVenueDestinationMarkup\(profile, options = \{\}\)[\s\S]*?class="profile-venue-destination\$\{liveClass\}"[^>]*data-open-venue="\$\{safeVenueName\}"[^>]*aria-label="Open \$\{safeVenueName\} club details"[\s\S]*?class="profile-venue-name">\$\{safeVenueName\}<[\s\S]*?class="profile-venue-cue"/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-venue-destination,[\s\S]*?grid-template-columns: 36px minmax\(0, 1fr\) 18px !important;[\s\S]*?min-height: 58px !important;[\s\S]*?text-align: left !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.profile-venue-name,[\s\S]*?text-overflow: ellipsis !important;[\s\S]*?white-space: nowrap !important;/,
  );
  assert.match(
    liveApp,
    /profileVenueDestinationMarkup\(profile, \{ live: true \}\)[\s\S]*?profileVenueDestinationMarkup\(profile\)/,
  );
  assert.doesNotMatch(
    liveApp,
    /class="meta detail-line upcoming-venue-line">\$\{venueIconMarkup\(\)\}<button class="venue-inline-link"/,
  );
});

test("profile media uses a seamless three-column vertical library", () => {
  assert.ok(profilePolishBlock, "profile polish CSS block must exist");
  assert.match(
    liveApp,
    /action-first media library[\s\S]*?#profileBackdrop \.gallery \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;[\s\S]*?gap: 3px !important;[\s\S]*?overflow: visible !important;[\s\S]*?touch-action: pan-y !important;/,
  );
  assert.match(
    liveApp,
    /action-first media library[\s\S]*?#profileBackdrop \.gallery \.thumb \{[\s\S]*?width: 100% !important;[\s\S]*?min-width: 0 !important;[\s\S]*?aspect-ratio: 9 \/ 16 !important;[\s\S]*?scroll-snap-align: none !important;/,
  );
  assert.match(liveApp, /profile-media-lazy-sentinel \{[\s\S]*?grid-column: 1 \/ -1 !important;/);
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
  const liveActionsMarkup = liveApp.match(
    /function liveProfileModalActionsMarkup\(profile, status\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const followIndex = liveActionsMarkup.indexOf('id="followBtn"');
  const notifyIndex = liveActionsMarkup.indexOf('id="notifyBtn"');
  const goingIndex = liveActionsMarkup.indexOf('${goingButton}');
  const shareIndex = liveActionsMarkup.indexOf('class="action-btn secondary profile-share-action profile-action-icon-control"');
  const reportIndex = liveActionsMarkup.indexOf('class="profile-report-action"');
  assert.ok(followIndex > -1 && notifyIndex > followIndex);
  assert.ok(goingIndex > notifyIndex && shareIndex > goingIndex);
  assert.ok(reportIndex > shareIndex);
  assert.match(
    liveApp,
    /class="action-btn follow-primary[\s\S]*?id="followBtn"/,
  );
  assert.match(liveApp, /id="notifyBtn"/);
  assert.match(liveApp, /id="goingBtn"/);
  assert.match(
    liveApp,
    /class="action-btn secondary profile-share-action profile-action-icon-control"[\s\S]*?data-profile-share-menu=/,
  );
  assert.match(liveApp, /class="profile-report-action" id="reportBtn" type="button"/);
  assert.doesNotMatch(liveActionsMarkup, /profile-schedule-action|profile-action-overflow|>Schedule<|>More</);
  assert.match(liveActionsMarkup, /id="notifyBtn"[\s\S]*?\$\{goingButton\}[\s\S]*?profile-share-action[\s\S]*?profile-report-action/);
  assert.doesNotMatch(liveActionsMarkup, /rideAction|directionsAction|dancerProfileUberRideMarkup|dancerProfileDirectionsMarkup/);
  assert.doesNotMatch(
    liveActionsMarkup.match(/<button class="action-btn secondary profile-share-action profile-action-icon-control"[^>]*>/)?.[0] || "",
    /disabled|aria-disabled/,
  );
  assert.match(
    liveApp,
    /\(actionButton\.id === "followBtn" \|\| actionButton\.id === "notifyBtn"\)[\s\S]*?!requireCustomerAccountForProfileAction\(actionButton\)/,
  );
  assert.match(
    liveApp,
    /Keep profile-level actions separate from the venue travel controls[\s\S]*?#profileBackdrop \.modal-actions \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/,
  );
  assert.match(
    liveApp,
    /#profileBackdrop \.modal-actions \.profile-share-action \{\s*grid-column: auto !important;/,
  );
  assert.match(
    liveActionsMarkup,
    /profileActionButtonMarkup\("share", "Share"\)/,
  );
  assert.match(
    aesthetic,
    /Tonight travel controls stay secondary and compact[\s\S]*?\.profile-tonight-travel-actions > :is\(a, button\) \{[\s\S]*?height: 44px !important;[\s\S]*?min-height: 44px !important;[\s\S]*?max-height: 44px !important;[\s\S]*?font-size: 11px !important;/,
  );
  assert.match(
    aesthetic,
    /Share opens publicly[\s\S]*?#profileBackdrop #profileModal \.modal-actions \.action-btn\.profile-share-action\.profile-action-icon-control,[\s\S]*?padding: 8px 4px !important;/,
  );
  assert.match(liveApp, /function dancerProfileTonightTravelActionsMarkup[\s\S]*?const directionsMarkup = dancerProfileDirectionsMarkup\(profile, \{ city \}\)[\s\S]*?const rideMarkup = dancerProfileUberRideMarkup\(profile, \{ city \}\)/);
  assert.match(liveActionsMarkup, /modal-actions \$\{isWorkingNow \? "is-working-now" : profile\?\.scheduled \? "is-upcoming-shift" : "is-no-live-shift"\}/);
  assert.match(liveApp, /function dancerProfileUberRideMarkup\(profile, options = \{\}\)[\s\S]*?!isWorkingTonight\(profile, city\)\) return "";/);
  assert.match(liveApp, /function dancerProfileDirectionsMarkup\(profile, options = \{\}\)[\s\S]*?if \(options\.preview \|\| !profile\?\.scheduled\) return "";/);
  assert.match(liveApp, /\.modal-actions\.is-no-live-shift \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/);
  assert.match(liveApp, /\.profile-report-action \{[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?justify-self: end !important;[\s\S]*?background: transparent !important;/);
});

test("profile socials and activity metrics use a compact neutral presentation", () => {
  const compactProfileBlock = aesthetic.match(
    /Full-profile actions and supporting information stay compact[\s\S]*?Production TV-card branding/,
  )?.[0] || "";

  assert.match(
    compactProfileBlock,
    /#profileBackdrop \.social-tile \{[\s\S]*?padding: 6px 0 4px !important;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop \.social-tile \.social-link \{[\s\S]*?width: 44px !important;[\s\S]*?height: 44px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop \.social-tile \.social-link svg \{[\s\S]*?width: 20px !important;[\s\S]*?height: 20px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop \.profile-activity-metrics::before \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop \.profile-activity-metrics \{[\s\S]*?margin-top: -2px !important;[\s\S]*?padding: 2px 0 4px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop \.profile-activity-metrics > div \{[\s\S]*?gap: 2px !important;[\s\S]*?padding: 3px 5px !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-activity-metrics,[\s\S]*?\.public-profile-shell \.profile-overview \{[\s\S]*?border: 0 !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-activity-metrics > div \+ div,[\s\S]*?\.public-profile-shell \.profile-metrics > div \+ div \{[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /@media \(max-width: 759px\) \{[\s\S]*?#profileBackdrop \.profile-activity-metrics \{[\s\S]*?margin-bottom: 10px !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-modal \{[\s\S]*?height: auto !important;[\s\S]*?min-height: 0 !important;[\s\S]*?max-height: min\(94vh, calc\(100dvh - var\(--mydancr-preview-banner-offset\)\)\) !important;/,
  );
  assert.match(
    liveApp,
    /const followerCount = followerNumber\(profile, city\);[\s\S]*?id="modalFollowerLabel">\$\{followerCount === 1 \? "Follower" : "Followers"\}/,
  );
  assert.match(liveApp, /<dt>Views today<\/dt>/);
  assert.match(
    liveApp,
    /followerLabelEl\.textContent = followerCount === 1 \? "Follower" : "Followers"/,
  );
  const publicSocialMarkup = liveApp.match(
    /function socialLinksMarkup\(profile, options = \{\}\) \{[\s\S]*?function approvedDancerShiftVenues/,
  )?.[0] || "";
  assert.match(publicSocialMarkup, /aria-label="External profiles"/);
  assert.match(publicSocialMarkup, /class="social-links" role="list"/);
  assert.doesNotMatch(publicSocialMarkup, />Social links</);
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
  assert.match(gridFunction, /<section class="\$\{tonightClasses\}" aria-label="Tonight">[\s\S]*?class="profile-tonight-deal">\$\{dealMarkup\}<\/div>[\s\S]*?<\/section>/);
  assert.match(liveApp, /class="profile-modal-context" aria-live="polite">\s*<span class="pill" id="modalCity">Las Vegas<\/span>/);
  assert.match(liveApp, /data-working-now-indicator aria-hidden="true">NOW<\/span>/);
  assert.doesNotMatch(liveApp, /profile-modal-live-status|modalLiveStatus/);
  assert.doesNotMatch(liveApp, /id="modalShiftStatus"|id="modalShiftVenue"/);
  assert.match(liveApp, /modalCity\.hidden = false/);
  assert.match(
    liveApp,
    /class="info-tile profile-schedule-card profile-shift-card schedule-upcoming">[\s\S]*?<div class="profile-schedule-primary">\$\{displayPublicShiftTime\(profile\.time, profile\)\}<\/div>/,
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
    /#profileBackdrop \.profile-modal-video-controls \{[\s\S]*?right: 10px;[\s\S]*?grid-template-columns: 36px 36px minmax\(88px, 1fr\) 64px 36px;[\s\S]*?border-radius: 999px;[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/,
  );
  assert.match(liveApp, /#profileBackdrop \.profile-modal-video-controls\.is-visible,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
  assert.match(liveApp, /#profileBackdrop \.profile-modal-video-controls button \{[\s\S]*?border-radius: 50% !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(liveApp, /#profileBackdrop \.profile-modal-media-expand \{[\s\S]*?border-radius: 50% !important;[\s\S]*?background: rgba\(12,12,20,\.72\) !important;/);
  assert.match(liveApp, /#profileBackdrop \.profile-modal-video-controls input\[type="range"\] \{[\s\S]*?height: 16px !important;[\s\S]*?border: 0 !important;[\s\S]*?background-color: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(liveApp, /#profileBackdrop \.profile-modal-video-controls output \{[\s\S]*?min-width: 64px;[\s\S]*?font-size: 10px;[\s\S]*?font-variant-numeric: tabular-nums;/);
  assert.match(liveApp, /id="modalVideoTime"[\s\S]*?class="profile-modal-media-expand" id="modalMediaExpand"/);
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
    /#profileBackdrop \.profile-modal-summary \{[\s\S]*?grid-template-columns: 48px minmax\(0, 1fr\);[\s\S]*?min-height: 66px;[\s\S]*?margin-inline: -12px;/,
  );
  assert.match(
    liveApp,
    /@media \(max-width: 520px\) \{[\s\S]*?#profileBackdrop \.modal-actions \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/,
  );
  assert.match(
    liveApp,
    /--profile-bottom-nav-clearance: max\(132px, calc\(108px \+ env\(safe-area-inset-bottom, 0px\)\)\);[\s\S]*?#profileBackdrop \.profile-modal-media \{[\s\S]*?padding-bottom: var\(--profile-bottom-nav-clearance\) !important;/,
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
    /@media \(max-width: 520px\) \{[\s\S]*?#profileBackdrop \.profile-modal-summary \{[\s\S]*?grid-template-columns: 48px minmax\(0, 1fr\);[\s\S]*?min-height: 66px;[\s\S]*?#profileBackdrop \.profile-modal-avatar \{\s*width: 48px;/,
  );
  assert.match(
    profilePolishBlock,
    /#profileBackdrop #modalCity \{[\s\S]*?min-height: 22px !important;[\s\S]*?border-radius: 999px !important;/,
  );
  assert.match(profilePolishBlock, /#profileBackdrop \.profile-modal-summary \{[\s\S]*?border-bottom: 0;/);
  assert.doesNotMatch(liveApp, /profileModalMediaTitle|profileModalMediaCount|profile-modal-media-head/);
  assert.match(liveApp, /<section class="profile-modal-media" aria-label="Dancer profile media">\s*<div class="profile-modal-media-tabs"/);
  assert.match(
    liveApp,
    /action-first media library[\s\S]*?#profileBackdrop \.profile-modal-media-tabs \{[\s\S]*?position: sticky !important;[\s\S]*?min-height: 40px !important;[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/,
  );
  assert.match(
    liveApp,
    /action-first media library[\s\S]*?body\.dancr-button-system #profileBackdrop \.profile-modal-media-tabs button \{[\s\S]*?min-height: 40px !important;[\s\S]*?border-radius: 0 !important;/,
  );
  assert.match(profilePolishBlock, /#profileBackdrop \.profile-media-tab-label \{[\s\S]*?font-weight: 900;/);
  assert.match(liveApp, /action-first media library[\s\S]*?#profileBackdrop \.profile-media-tab-icon \{[\s\S]*?width: 16px !important;[\s\S]*?height: 16px !important;/);
});

test("Working Now profiles do not repeat the Club Confirmed check-in card", () => {
  assert.match(
    liveApp,
    /function profileLocationStatusTile\(profile, city = selectedCity\(\)\) \{\s+if \(isWorkingTonight\(profile, city\)\) return "";/,
  );
  assert.match(liveApp, /\$\{profileLocationStatusTile\(profile, city\)\}/);
});

test("inactive profile Club Deals keep a neutral placeholder", () => {
  const dealMarkup = liveApp.match(
    /function profileDealTileMarkup\(profile\) \{[\s\S]*?(?=\n    function profileShareText)/,
  )?.[0] || "";
  assert.match(dealMarkup, /if \(state\.key === "available"\)/);
  assert.match(dealMarkup, /profile-club-deal-tile is-inactive/);
  assert.match(dealMarkup, /aria-label="Inactive Club Deal"/);
  assert.match(dealMarkup, /<span class="profile-club-deal-action-copy"><strong>Inactive<\/strong><\/span>/);
  assert.doesNotMatch(dealMarkup, /Tap How to use for instructions|Tap to choose an offer and view instructions/);
  assert.match(liveApp, /#profileBackdrop #profileModal \.modal-body \{[\s\S]*?padding-bottom: 0 !important;/);
  assert.match(liveApp, /\.profile-club-deal-tile\.is-inactive \.profile-club-deal-qr-button \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?place-items: center !important;/);
});
