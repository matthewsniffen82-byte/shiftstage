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
const publicProfilePage = await readFile(
  new URL("../app/dancers/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const publicSocialLinks = await readFile(
  new URL("../app/dancers/[slug]/SocialLinks.tsx", import.meta.url),
  "utf8",
);

const profilePolishBlock = liveApp.match(
  /\/\* Instagram-familiar dancer profile hierarchy; scoped away from global navigation\. \*\/[\s\S]*?\/\* Venue profiles keep X dismissal/,
)?.[0];

test("empty schedules use the compact neutral hierarchy while upcoming schedules retain their destination", () => {
  assert.match(
    liveApp,
    /if \(profile\.scheduled\) \{[\s\S]*?const upcomingDateLabel = compactUpcomingDateLabel\(profile\)[\s\S]*?class="info-tile profile-schedule-card profile-shift-card schedule-upcoming"[\s\S]*?Upcoming · \$\{escapeHtml\(upcomingDateLabel\)\}[\s\S]*?profileVenueDestinationMarkup\(profile, \{ upcoming: true \}\)/,
  );
  assert.match(
    liveApp,
    /const emptyScheduleCopy =[\s\S]*?`Follow \$\{escapeHtml\(profile\.name\)\} for updates`;[\s\S]*?class="info-tile profile-schedule-card profile-shift-card schedule-empty" aria-label="Schedule status">[\s\S]*?class="profile-empty-state">No shift posted<\/span>[\s\S]*?class="profile-empty-copy">[\s\S]*?\$\{emptyScheduleCopy\}/,
  );
  assert.doesNotMatch(
    liveApp,
    /return `\s*<div class="info-tile">\s*<strong>Now<\/strong>[\s\S]*?<strong>Next shift<\/strong>[\s\S]*?No shift posted/,
  );
  assert.match(aesthetic, /profile-tonight-card\.is-no-schedule[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(aesthetic, /profile-tonight-card > \.schedule-empty,[\s\S]*?profile-schedule-empty \{[\s\S]*?min-height: 48px !important;/);
  assert.match(aesthetic, /profile-tonight-card\.is-no-schedule \.schedule-empty::before,[\s\S]*?content: none !important;/);
  assert.match(
    aesthetic,
    /public-profile-shell \.profile-tonight-card\.is-upcoming::before \{[\s\S]*?var\(--dancr-color-info\) 55%, transparent/,
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
    /function profileVenueDestinationMarkup\(profile, options = \{\}\)[\s\S]*?const statusClass = options\.live \? " is-live" : options\.upcoming \? " is-upcoming" : "";[\s\S]*?class="profile-venue-destination\$\{statusClass\}\$\{venueNameSizeClass\}"[^>]*data-open-venue="\$\{safeVenueName\}"[^>]*aria-label="Open \$\{safeVenueName\} club details"[\s\S]*?class="profile-venue-name">\$\{safeVenueName\}<[\s\S]*?class="profile-venue-cue"/,
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
    /profileVenueDestinationMarkup\(profile, \{ live: true \}\)[\s\S]*?profileVenueDestinationMarkup\(profile, \{ upcoming: true \}\)/,
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
  assert.ok(followIndex > -1 && notifyIndex > followIndex);
  assert.ok(goingIndex > notifyIndex && shareIndex > goingIndex);
  assert.doesNotMatch(liveActionsMarkup, /profile-report-action|Report profile/);
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
  assert.doesNotMatch(liveApp, /class="profile-modal-report-link"|id="reportBtn"/);
  assert.doesNotMatch(liveApp, /profileReportButton\.textContent\s*=\s*"Report"/);
  assert.doesNotMatch(liveApp, /id="profileActionOverflowToggle"|id="profileActionOverflowMenu"/);
  assert.doesNotMatch(liveActionsMarkup, /profile-schedule-action|profile-action-overflow|>Schedule<|>More</);
  assert.match(liveActionsMarkup, /id="notifyBtn"[\s\S]*?\$\{goingButton\}[\s\S]*?profile-share-action/);
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
    /Share uses the same vertical inset[\s\S]*?#profileBackdrop #profileModal \.modal-actions \.action-btn\.profile-share-action\.profile-action-icon-control,[\s\S]*?padding: 1px 2px !important;/,
  );
  assert.match(liveApp, /function dancerProfileTonightTravelActionsMarkup[\s\S]*?const directionsMarkup = dancerProfileDirectionsMarkup\(profile, \{ city \}\)[\s\S]*?const rideMarkup = dancerProfileUberRideMarkup\(profile, \{ city \}\)/);
  assert.match(liveActionsMarkup, /modal-actions \$\{isWorkingNow \? "is-working-now" : profile\?\.scheduled \? "is-upcoming-shift" : "is-no-live-shift"\}/);
  assert.match(liveApp, /function dancerProfileUberRideMarkup\(profile, options = \{\}\)[\s\S]*?if \(options\.preview \|\| !profile\?\.scheduled\) return "";/);
  assert.match(liveApp, /const statusClass = isWorkingTonight\(profile, city\) \? "is-working-now" : "is-upcoming";/);
  assert.match(liveApp, /function dancerProfileDirectionsMarkup\(profile, options = \{\}\)[\s\S]*?if \(options\.preview \|\| !profile\?\.scheduled\) return "";/);
  assert.match(liveApp, /\.modal-actions\.is-no-live-shift \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;/);
  assert.match(liveApp, /\.profile-modal-header-controls \{[\s\S]*?position: absolute !important;[\s\S]*?grid-template-columns: 36px/);
});

test("profile socials stay secondary, responsive, and absent when no links exist", () => {
  const compactProfileBlock = aesthetic.match(
    /Optional dancer-profile engagement content uses natural document flow[\s\S]*?Production TV-card branding/,
  )?.[0] || "";
  const liveProfileBlock = liveApp.match(
    /Dancer profile socials stay secondary to MyDancr actions and media[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{\s*\.uber-ride-link/,
  )?.[0] || "";

  assert.match(
    compactProfileBlock,
    /#profileBackdrop #profileModal \.social-tile,[\s\S]*?\.public-profile-shell \.profile-social-section \{[\s\S]*?min-height: 0 !important;[\s\S]*?margin: 0 0 6px !important;[\s\S]*?padding: 0 !important;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop #profileModal \.social-tile \.social-link,[\s\S]*?\.public-profile-shell \.profile-social-section \.social-list a \{[\s\S]*?width: 44px !important;[\s\S]*?height: 44px !important;[\s\S]*?min-width: 44px !important;[\s\S]*?min-height: 44px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop #profileModal \.social-tile \.social-link svg,[\s\S]*?\.public-profile-shell \.profile-social-section \.social-list a svg \{[\s\S]*?width: 14px !important;[\s\S]*?height: 14px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /\.social-list \{[\s\S]*?--profile-row-inline-start: clamp\(24px, 7vw, 28px\);[\s\S]*?width: fit-content !important;[\s\S]*?flex-wrap: nowrap !important;[\s\S]*?justify-content: flex-start !important;[\s\S]*?gap: 6px !important;[\s\S]*?margin-inline: var\(--profile-row-inline-start\) 0 !important;[\s\S]*?overflow: visible !important;/,
  );
  assert.match(
    compactProfileBlock,
    /\.social-list a::before \{[\s\S]*?inset: 3px !important;[\s\S]*?border: 1px solid rgba\(226, 232, 240, \.11\) !important;[\s\S]*?background: rgba\(9, 9, 13, \.86\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    compactProfileBlock,
    /\.social-list a:hover::before \{[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    compactProfileBlock,
    /\.social-instagram,[\s\S]*?\.social-link-instagram \{[\s\S]*?color: #e4405f !important;[\s\S]*?\.social-tiktok,[\s\S]*?color: #25f4ee !important;[\s\S]*?\.social-snapchat,[\s\S]*?color: #fffc00 !important;[\s\S]*?\.social-onlyfans,[\s\S]*?color: #00aff0 !important;/,
  );
  assert.match(
    compactProfileBlock,
    /#profileBackdrop #profileModal \.profile-activity-metrics \{[\s\S]*?margin-bottom: 26px !important;[\s\S]*?#profileBackdrop #profileModal \.profile-activity-metrics:has\(\+ \.social-tile\) \{[\s\S]*?margin-bottom: 9px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /\.public-profile-shell \.profile-overview \{[\s\S]*?margin-bottom: 26px !important;[\s\S]*?\.public-profile-shell \.profile-overview:has\(\+ \.profile-social-section\) \{[\s\S]*?margin-bottom: 18px !important;/,
  );
  assert.match(
    compactProfileBlock,
    /profile-activity-metrics dd,[\s\S]*?\.profile-metrics dd \{[\s\S]*?font-variant-numeric: tabular-nums !important;[\s\S]*?text-overflow: ellipsis !important;[\s\S]*?white-space: nowrap !important;/,
  );
  assert.match(
    liveProfileBlock,
    /\.modal-actions \.profile-report-action \{[\s\S]*?position: static !important;[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?min-height: 24px !important;[\s\S]*?justify-self: end !important;/,
  );
  assert.match(
    liveProfileBlock,
    /\.social-tile \.social-links \{[\s\S]*?flex-wrap: nowrap !important;[\s\S]*?gap: 6px !important;[\s\S]*?overflow: visible !important;/,
  );
  assert.match(publicSocialLinks, /M18\.244 2\.25h3\.308l-7\.227 8\.26/);
  assert.match(liveApp, /x: '<span class="social-icon fill"[\s\S]*?M18\.244 2\.25h3\.308l-7\.227 8\.26/);
  assert.match(publicSocialLinks, /if \(!links\.length\) return null;/);
  assert.match(
    liveApp,
    /const followerCount = followerNumber\(profile, city\);[\s\S]*?id="modalFollowerLabel">\$\{followerCount === 1 \? "Follower" : "Followers"\}/,
  );
  assert.match(liveApp, /<dt>Views today<\/dt>/);
  assert.match(
    liveApp,
    /const followerLabel = followerCount === 1 \? "Follower" : "Followers";[\s\S]*?followerLabelEl\.textContent = followerLabel/,
  );
  const publicSocialMarkup = liveApp.match(
    /function socialLinksMarkup\(profile, options = \{\}\) \{[\s\S]*?function approvedDancerShiftVenues/,
  )?.[0] || "";
  assert.match(publicSocialMarkup, /if \(!links\.length\) \{\s*return "";\s*\}/);
  assert.match(publicSocialMarkup, /aria-label="External profiles"/);
  assert.match(publicSocialMarkup, /class="social-links" role="list"/);
  assert.doesNotMatch(publicSocialMarkup, />Social links</);

  const publicActionsIndex = publicProfilePage.indexOf("<DancerProfileActions");
  const publicMetricsIndex = publicProfilePage.indexOf('className="profile-header-metrics"');
  const publicSocialIndex = publicProfilePage.indexOf("profile.socialLinks.length ?");
  const publicMediaIndex = publicProfilePage.indexOf("<DancerPhotoCarousel");
  assert.ok(publicMetricsIndex > -1 && publicActionsIndex > publicMetricsIndex);
  assert.ok(publicSocialIndex > publicActionsIndex && publicMediaIndex > publicSocialIndex);
  assert.doesNotMatch(publicProfilePage, /className="profile-overview"/);
});

test("profile action controls are unboxed, left grouped, and available Going highlights only its icon", () => {
  const guestActionsBlock = aesthetic.match(
    /\/\* Guest actions read as a single icon row[\s\S]*?(?=\/\* Production TV-card branding)/,
  )?.[0] || "";
  assert.match(
    guestActionsBlock,
    /modal-actions \.action-btn\.profile-action-icon-control,[\s\S]*?profile-action-share-slot \.profile-share > button\.profile-action-icon-control \{[\s\S]*?border-color: transparent !important;[\s\S]*?background: transparent !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    guestActionsBlock,
    /live-actions > button\.profile-action-secondary\.profile-action-icon-control:not\(\[aria-pressed="true"\]\),[\s\S]*?live-actions > button\.profile-action-going\.profile-action-icon-control:not\(\[aria-pressed="true"\]\)/,
  );
  assert.match(
    guestActionsBlock,
    /#profileBackdrop #profileModal \.modal-actions,[\s\S]*?\.public-profile-shell \.live-actions \{[\s\S]*?--profile-row-inline-start: clamp\(24px, 7vw, 28px\);[\s\S]*?grid-template-columns: repeat\(4, clamp\(52px, 15vw, 56px\)\) !important;[\s\S]*?justify-content: start !important;[\s\S]*?column-gap: clamp\(4px, 2vw, 8px\) !important;[\s\S]*?padding: 2px 4px 2px var\(--profile-row-inline-start\) !important;/,
  );
  assert.match(
    aesthetic,
    /four customer actions share one quiet premium tray[\s\S]*?\.public-profile-shell \.live-actions \{[\s\S]*?border-radius: 22px !important;[\s\S]*?background: rgba\(7, 7, 11, \.92\) !important;/,
  );
  assert.match(
    guestActionsBlock,
    /profile-action-icon-frame\[data-profile-action-icon="personPlus"\] \.profile-action-preview-icon \{[\s\S]*?width: 20px !important;[\s\S]*?height: 20px !important;/,
  );
  assert.match(
    guestActionsBlock,
    /going-btn\.is-available-action:not\(\.is-going\) \.action-icon,[\s\S]*?profile-action-going\.profile-action-available:not\(\.is-going\) \.profile-action-icon-frame \{[\s\S]*?width: 26px !important;[\s\S]*?height: 26px !important;[\s\S]*?display: inline-grid !important;[\s\S]*?place-items: center !important;[\s\S]*?box-sizing: border-box !important;[\s\S]*?padding: 0 !important;[\s\S]*?border: 1px solid rgba\(216, 180, 254, \.82\) !important;[\s\S]*?border-radius: 50% !important;[\s\S]*?color: #f5d0fe !important;[\s\S]*?radial-gradient\(circle, rgba\(168, 85, 247, \.2\) 0%, rgba\(88, 28, 135, \.08\) 72%\)[\s\S]*?0 0 0 2px rgba\(168, 85, 247, \.14\)[\s\S]*?0 0 14px rgba\(168, 85, 247, \.72\)/,
  );
  assert.match(
    guestActionsBlock,
    /going-btn\.is-available-action:not\(\.is-going\) \.action-icon > svg,[\s\S]*?profile-action-going\.profile-action-available:not\(\.is-going\) \.profile-action-preview-icon \{[\s\S]*?--profile-icon-offset-x: 0px !important;[\s\S]*?--profile-icon-offset-y: 0px !important;[\s\S]*?display: block !important;[\s\S]*?margin: 0 !important;[\s\S]*?drop-shadow\(0 0 5px rgba\(245, 208, 254, \.95\)\)[\s\S]*?drop-shadow\(0 0 12px var\(--dancr-color-brand-primary-strong\)\) !important;[\s\S]*?\.is-available-action:not\(\.is-going\) \.profile-action-main > span:last-child,[\s\S]*?color: #f3e8ff !important;[\s\S]*?text-shadow: 0 0 12px rgba\(168, 85, 247, \.72\) !important;/,
  );
  assert.match(
    guestActionsBlock,
    /going-btn\.is-available-action\.is-going \.action-icon,[\s\S]*?profile-action-going\.profile-action-available\.is-going \.profile-action-icon-frame \{[\s\S]*?color: #f0abfc !important;[\s\S]*?drop-shadow\(0 0 5px rgba\(240, 171, 252, \.95\)\)[\s\S]*?drop-shadow\(0 0 12px var\(--dancr-color-brand-primary-strong\)\) !important;[\s\S]*?\.is-going \.profile-action-main > span:last-child \{[\s\S]*?color: #fae8ff !important;/,
  );
});

test("mobile full profiles keep identity, analytics, and close control on one compact plane", () => {
  const compactMobileProfile = aesthetic.match(
    /The home-profile overlay keeps identity and analytics[\s\S]*?(?=\/\* Production TV-card branding)/,
  )?.[0] || "";

  assert.ok(compactMobileProfile, "compact mobile profile CSS must exist");
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-summary \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?min-height: 66px !important;[\s\S]*?padding: max\(7px, calc\(env\(safe-area-inset-top, 0px\) \+ 4px\)\) 46px 7px 10px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-person \{[\s\S]*?grid-template-columns: 60px minmax\(0, 1fr\) !important;[\s\S]*?align-items: start !important;[\s\S]*?gap: 4px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-avatar-column \{[\s\S]*?position: relative !important;[\s\S]*?z-index: 5 !important;[\s\S]*?grid-template-rows: 48px 14px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-summary \.modal-identity-stack \{[\s\S]*?height: 57px !important;[\s\S]*?grid-template-rows: 24px 29px !important;[\s\S]*?gap: 4px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-header-controls \{[\s\S]*?position: absolute !important;[\s\S]*?top: max\(5px,[\s\S]*?right: 5px !important;[\s\S]*?grid-template-columns: 36px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal #modalCity \{[\s\S]*?transform: translateY\(3px\) !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-header-metrics \{[\s\S]*?position: relative !important;[\s\S]*?z-index: 1 !important;[\s\S]*?width: calc\(100% - 12px\) !important;[\s\S]*?margin-left: -4px !important;[\s\S]*?transform: none !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-name-row \{[\s\S]*?justify-content: flex-start !important;[\s\S]*?padding-inline-start: clamp\(14px, 4vw, 18px\) !important;/,
  );
  assert.match(
    aesthetic,
    /three analytics columns sit in the visual spaces between the[\s\S]*?#profileBackdrop #profileModal \.modal-actions \{[\s\S]*?width: auto !important;[\s\S]*?margin-inline: 12px !important;/,
  );
  assert.match(
    aesthetic,
    /Align the stage-name start with the rendered Follower\/Followers word below[\s\S]*?\.profile-modal-summary \.modal-identity \{[\s\S]*?position: relative !important;[\s\S]*?inset: 0 auto auto 0 !important;[\s\S]*?width: 100% !important;[\s\S]*?max-width: none !important;[\s\S]*?justify-self: stretch !important;[\s\S]*?#profileBackdrop #profileModal \.profile-modal-header-metrics \{[\s\S]*?margin-left: -4px !important;[\s\S]*?transform: none !important;[\s\S]*?#profileBackdrop #profileModal \.profile-modal-name-row \{[\s\S]*?position: relative !important;[\s\S]*?inset: auto !important;[\s\S]*?width: calc\(\(100% - 22px\) \/ 3\) !important;[\s\S]*?max-width: none !important;[\s\S]*?margin: 0 0 0 -4px !important;[\s\S]*?transform: none !important;[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\) !important;[\s\S]*?gap: 0 !important;/,
  );
  assert.match(
    aesthetic,
    /Align the stage-name start with the rendered Follower\/Followers word below[\s\S]*?\.profile-modal-name-row::before \{[\s\S]*?content: attr\(data-follower-label\) !important;[\s\S]*?display: block !important;[\s\S]*?grid-column: 2 !important;[\s\S]*?visibility: hidden !important;[\s\S]*?font-size: 9px !important;[\s\S]*?font-weight: 800 !important;[\s\S]*?white-space: nowrap !important;[\s\S]*?#profileBackdrop #profileModal \.profile-modal-name-anchor \{[\s\S]*?position: absolute !important;[\s\S]*?grid-column: 2 !important;[\s\S]*?width: fit-content !important;[\s\S]*?max-width: 66px !important;[\s\S]*?align-self: center !important;[\s\S]*?justify-self: start !important;[\s\S]*?#profileBackdrop #profileModal \.profile-modal-name-row h2 \{[\s\S]*?max-width: 100% !important;[\s\S]*?text-align: left !important;[\s\S]*?\.profile-modal-name-row \.profile-modal-verified \{[\s\S]*?position: absolute !important;[\s\S]*?inset: 50% auto auto calc\(100% \+ 5px\) !important;[\s\S]*?transform: translateY\(-50%\) !important;/,
  );
  assert.match(
    liveApp,
    /class="profile-modal-name-row" data-follower-label="Followers">\s*<div class="profile-modal-name-anchor">\s*<h2 id="modalName">Profile<\/h2>\s*<span class="profile-modal-verified" id="modalVerified" aria-label="Verified dancer">✓<\/span>\s*<\/div>/,
  );
  assert.match(
    liveApp,
    /modalProfileMetrics\.innerHTML = profileActivityMetricsMarkup\(profile, city\);[\s\S]*?modalName\.closest\("\.profile-modal-name-row"\)\?\.setAttribute\([\s\S]*?"data-follower-label",[\s\S]*?modalProfileMetrics\.querySelector\("#modalFollowerLabel"\)\?\.textContent\?\.trim\(\) \|\| "Followers"/,
  );
  assert.match(
    liveApp,
    /const followerLabel = followerCount === 1 \? "Follower" : "Followers";[\s\S]*?followerLabelEl\.textContent = followerLabel;[\s\S]*?modalName\.closest\("\.profile-modal-name-row"\)\?\.setAttribute\("data-follower-label", followerLabel\);/,
  );
  assert.doesNotMatch(
    aesthetic,
    /Align the stage-name start with the rendered Follower\/Followers word below[\s\S]*?#profileBackdrop #profileModal \.profile-modal-name-row \{\s*position: absolute !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop #profileModal #modalClose \{[\s\S]*?width: 36px !important;[\s\S]*?min-width: 36px !important;[\s\S]*?max-width: 36px !important;[\s\S]*?height: 36px !important;[\s\S]*?max-height: 36px !important;[\s\S]*?aspect-ratio: 1 \/ 1 !important;[\s\S]*?display: inline-grid !important;[\s\S]*?place-items: center !important;[\s\S]*?linear-gradient\(145deg,[\s\S]*?backdrop-filter: blur\(12px\) saturate\(120%\) !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop #profileModal #modalClose \.icon \{[\s\S]*?width: 15px !important;[\s\S]*?height: 15px !important;[\s\S]*?stroke-width: 1\.85 !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-modal-header-metrics \{[\s\S]*?align-self: stretch !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-club-deal-qr-button \{[\s\S]*?min-height: 44px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /\.modal-actions \.action-btn\.profile-action-icon-control,[\s\S]*?min-height: 44px !important;/,
  );
  assert.match(
    compactMobileProfile,
    /\.modal-actions \.profile-report-action,[\s\S]*?position: static !important;[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?min-height: 24px !important;[\s\S]*?justify-self: end !important;/,
  );
  assert.match(
    compactMobileProfile,
    /#profileBackdrop #profileModal \.profile-activity-metrics > div,[\s\S]*?gap: 1px !important;[\s\S]*?padding: 2px 4px !important;/,
  );
  assert.doesNotMatch(compactMobileProfile, /grid-template-columns: 38px minmax\(0, 1fr\) !important;/);
  assert.match(compactMobileProfile, /profile-tonight-card\.has-club-deal[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  assert.doesNotMatch(liveApp, /profile-club-deal-context">Available tonight at/);
});

test("home profile overlay mirrors the public profile information hierarchy", () => {
  const gridFunction = liveApp.match(
    /function profileModalGridMarkup\(profile, options = \{\}\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const renderedMarkup = gridFunction.slice(gridFunction.indexOf("return `"));
  const actionsIndex = renderedMarkup.indexOf("liveProfileModalActionsMarkup");
  const scheduleIndex = renderedMarkup.indexOf("shiftsMarkup");
  const dealIndex = renderedMarkup.indexOf("dealMarkup ?");
  const socialIndex = renderedMarkup.indexOf("${socialMarkup}");

  assert.ok(scheduleIndex > -1);
  assert.ok(actionsIndex > -1 && scheduleIndex > actionsIndex);
  assert.ok(dealIndex > scheduleIndex && socialIndex > dealIndex);
  assert.doesNotMatch(renderedMarkup, /profileActivityMetricsMarkup/);
  assert.match(liveApp, /id="modalProfileMetrics"/);
  assert.match(liveApp, /modalProfileMetrics\.innerHTML = profileActivityMetricsMarkup\(profile, city\)/);
  assert.match(gridFunction, /<section class="\$\{tonightClasses\}" data-profile-shift-state="\$\{shiftState\}" data-profile-deal-state="\$\{escapeHtml\(dealState\.key\)\}" aria-label="Tonight">[\s\S]*?\$\{dealMarkup \? `<div class="profile-tonight-deal">\$\{dealMarkup\}<\/div>` : ""\}[\s\S]*?<\/section>/);
  assert.match(liveApp, /class="profile-modal-avatar-column">[\s\S]*?<span class="pill" id="modalCity">Las Vegas<\/span>/);
  assert.match(liveApp, /data-working-now-indicator aria-hidden="true">NOW<\/span>/);
  assert.doesNotMatch(liveApp, /profile-modal-live-status|modalLiveStatus/);
  assert.doesNotMatch(liveApp, /id="modalShiftStatus"|id="modalShiftVenue"/);
  assert.match(liveApp, /modalCity\.hidden = false/);
  assert.match(
    liveApp,
    /class="info-tile profile-schedule-card profile-shift-card schedule-upcoming">[\s\S]*?<div class="profile-schedule-primary">Upcoming · \$\{escapeHtml\(upcomingDateLabel\)\}<\/div>[\s\S]*?profileVenueDestinationMarkup\(profile, \{ upcoming: true \}\)/,
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
  assert.match(dealMarkup, /const inactiveActionLabel = state\.key === "available-when-working" \? "At check-in" : "Inactive";/);
  assert.match(dealMarkup, /<span class="profile-club-deal-action-copy"><strong>\$\{escapeHtml\(inactiveActionLabel\)\}<\/strong><\/span>/);
  assert.doesNotMatch(dealMarkup, /Tap How to use for instructions|Tap to choose an offer and view instructions/);
  assert.match(liveApp, /#profileBackdrop #profileModal \.modal-body \{[\s\S]*?padding-bottom: 0 !important;/);
  assert.match(liveApp, /\.profile-club-deal-tile\.is-inactive \.profile-club-deal-qr-button \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?place-items: center !important;/);
});
