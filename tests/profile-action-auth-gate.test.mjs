import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, actionsSource, profilePageSource, reportsRouteSource, profileNavigationSource, venueFollowsRouteSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/ProfileNavigationActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/venue-follows/route.ts", import.meta.url), "utf8"),
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Expected ${start}`);
  assert.notEqual(endIndex, -1, `Expected ${end}`);
  return source.slice(startIndex, endIndex);
}

test("account-only live modal actions check for a customer profile while Going and Report stay public", () => {
  const handler = sourceBetween(
    homeSource,
    'profileModal.addEventListener("click"',
    'const modalCloseButton = document.getElementById("modalClose")',
  );

  assert.match(handler, /#followBtn, #goingBtn, #reportBtn/);
  assert.match(
    handler,
    /actionButton\.id === "followBtn" &&\s+!requireCustomerAccountForProfileAction\(actionButton\)/,
  );
  assert.doesNotMatch(handler, /#notifyBtn|actionButton\.id === "notifyBtn"/);
  assert.ok(
    handler.indexOf("requireCustomerAccountForProfileAction(actionButton)") <
      handler.indexOf('if (actionButton.id === "followBtn")'),
    "The account gate must run before any account-only optimistic update.",
  );
});

test("the live dancer profile close control exits shared links and remains touchable", () => {
  assert.match(
    homeSource,
    /id="modalClose" type="button" aria-label="Close profile"/,
  );
  assert.match(
    homeSource,
    /#modalClose \{[\s\S]*?width: 48px !important;[\s\S]*?min-height: 48px !important;[\s\S]*?pointer-events: auto !important;[\s\S]*?touch-action: manipulation !important;/,
  );
  assert.match(
    homeSource,
    /function clearProfileDeepLink\(\) \{[\s\S]*?url\.searchParams\.delete\("profile"\)[\s\S]*?window\.history\.replaceState/,
  );
  assert.match(
    homeSource,
    /function closeProfileModal\(\) \{[\s\S]*?profileBackdrop\.classList\.remove\("show"\)[\s\S]*?clearProfileDeepLink\(\)/,
  );
  assert.match(
    homeSource,
    /function closeProfileModal\(\) \{[\s\S]*?\]\.forEach\(\(closeOverlay\) => \{[\s\S]*?try \{[\s\S]*?closeOverlay\(\)[\s\S]*?Profile overlay cleanup failed/,
  );
  assert.match(
    homeSource,
    /\.modal-top \{[\s\S]*?z-index: 30;[\s\S]*?\.close-btn \{[\s\S]*?pointer-events: auto;[\s\S]*?touch-action: manipulation;/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop\.modal-backdrop\.show \{\s+z-index: 140 !important;[\s\S]*?#profileBackdrop #modalClose \{[\s\S]*?position: absolute !important;[\s\S]*?z-index: 221 !important;[\s\S]*?pointer-events: auto !important;/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.profile-modal \{[\s\S]*?overflow-x: hidden !important;[\s\S]*?overflow-y: auto !important;[\s\S]*?scroll-padding-bottom: max\(16px, env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?touch-action: pan-y !important;/,
  );
  assert.match(
    homeSource,
    /function resetProfileModalScroll\(\) \{[\s\S]*?\[profileBackdrop, profileModal\]\.forEach[\s\S]*?element\.scrollTop = 0;[\s\S]*?element\.scrollLeft = 0;[\s\S]*?element\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\);/,
  );
  assert.match(
    homeSource,
    /function focusProfileModalStart\(\) \{[\s\S]*?resetProfileModalScroll\(\);[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?resetProfileModalScroll\(\);[\s\S]*?requestAnimationFrame\(resetProfileModalScroll\);/,
  );
  assert.match(
    homeSource,
    /function openProfileModal\(profileReference, options = \{\}\) \{[\s\S]*?resetProfileModalScroll\(\);\s+profileBackdrop\.classList\.add\("show"\);[\s\S]*?focusProfileModalStart\(\);/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.modal-body \{[\s\S]*?flex: 0 0 auto !important;[\s\S]*?overflow: visible !important;[\s\S]*?padding-bottom: max\(16px, env\(safe-area-inset-bottom, 0px\)\) !important;/,
  );
  assert.match(
    homeSource,
    /#profileBackdrop \.modal-actions \{[\s\S]*?position: static !important;[\s\S]*?scroll-margin-bottom: max\(16px, env\(safe-area-inset-bottom, 0px\)\);/,
  );
  assert.match(
    homeSource,
    /--profile-bottom-nav-clearance: max\(132px, calc\(108px \+ env\(safe-area-inset-bottom, 0px\)\)\);[\s\S]*?scroll-padding-bottom: var\(--profile-bottom-nav-clearance\) !important;[\s\S]*?#profileBackdrop \.profile-modal-media \{[\s\S]*?margin: 12px 0 var\(--profile-bottom-nav-clearance\) !important;[\s\S]*?padding-bottom: 0 !important;/,
  );
  assert.doesNotMatch(homeSource, /--profile-report-clearance: calc\(80px/);
  assert.match(homeSource, /modalCloseButton\.addEventListener\("click"[\s\S]*?closeProfileModal\(\)/);
  assert.match(
    homeSource,
    /modalCloseButton\.addEventListener\("pointerdown", \(event\) => \{\s+event\.stopPropagation\(\);\s+\}, \{ passive: true \}\);/,
  );
  assert.match(
    homeSource,
    /document\.addEventListener\("click", \(event\) => \{[\s\S]*?event\.target\.closest\?\.\("#modalClose"\)[\s\S]*?closeProfileModal\(\);\s+\}, \{ capture: true \}\);/,
  );
  assert.match(profilePageSource, /<ProfileCloseButton[\s\S]*?fallbackHref=\{`\/\?city=\$\{encodeURIComponent\(profile\.city\)\}&view=dancers`\}/);
  assert.match(profileNavigationSource, /className="public-profile-close"/);
  assert.match(
    profileNavigationSource,
    /profileType = "dancer"[\s\S]*?aria-label={`Close full \$\{profileType\} profile and return to the previous page or discovery results`}/,
  );
  assert.match(profileNavigationSource, /window\.history\.back\(\)/);
  assert.match(profileNavigationSource, /window\.setTimeout\(navigateToFallback, 900\)/);
  assert.match(profileNavigationSource, /window\.location\.assign\(destination\.toString\(\)\)/);
  assert.match(profileNavigationSource, />\s*×\s*<\/button>/);
  assert.match(
    homeSource,
    /<div class="card-badges">[\s\S]*?<\/div>\s+\$\{options\.feedActions && !isPending \? `<span class="card-profile-destination" aria-hidden="true"><svg class="card-profile-symbol"[\s\S]*?<rect[\s\S]*?<circle[\s\S]*?<\/svg><svg class="card-profile-chevron"[\s\S]*?<\/svg><\/span>` : ""\}\s+<\/div>\s+<div class="profile-body">/,
  );
  assert.match(
    homeSource,
    /\.home-feed-card \.card-profile-destination \{[\s\S]*?top: 14px;[\s\S]*?right: 14px;[\s\S]*?width: 44px;[\s\S]*?height: 44px;[\s\S]*?border-radius: 999px;/,
  );
  assert.doesNotMatch(
    homeSource,
    /class="card-profile-destination">View full profile/,
  );
  assert.match(
    homeSource,
    /body\.overlay-open \.home-feed-card \.card-profile-destination \{\s+display: none !important;\s+\}/,
  );
  assert.match(
    homeSource,
    /\.profile-modal > \.modal-image > \.modal-identity-stack \{\s+display: none !important;\s+\}/,
  );
  assert.doesNotMatch(
    homeSource,
    /\$\{scheduleMarkup\}\s+\$\{options\.feedActions[\s\S]*?card-profile-destination/,
  );
});

test("signed-out profile actions open a dismissible account prompt with working signup and sign-in links", () => {
  assert.match(
    homeSource,
    /id="accountRequiredPopover" role="dialog" aria-modal="true"[^>]*hidden/,
  );
  assert.match(homeSource, /id="accountRequiredClose"[^>]*aria-label="Close account prompt"/);
  assert.match(
    homeSource,
    /id="accountRequiredCreateLink" href="\/account\?role=customer&amp;mode=signup"/,
  );
  assert.match(
    homeSource,
    /id="accountRequiredSignInLink" href="\/account\?role=customer"/,
  );
  assert.match(homeSource, /accountRequiredClose\?\.addEventListener\("click"/);
  assert.match(
    homeSource,
    /if \(event\.target === accountRequiredPopover\) closeAccountRequiredPrompt\(\)/,
  );
  assert.match(
    homeSource,
    /if \(accountRequiredPopover && !accountRequiredPopover\.hidden\) \{\s+closeAccountRequiredPrompt\(\)/,
  );
  assert.match(homeSource, /accountRequiredCreateLink\?\.addEventListener\("click"[\s\S]*openFreshCustomerSignup\(\)/);
  assert.match(
    homeSource,
    /\.account-required-popover \{\s+z-index: 1600;/,
  );
  assert.match(
    homeSource,
    /class="action-btn secondary follow-venue-btn[^"]*"[^>]*data-venue-follow="\$\{venueValue\}"[^>]*data-account-action="venue-follow"[^>]*aria-pressed="\$\{followsVenue\}"/,
  );
});

test("guest account prompts use a compact benefit-led hierarchy without duplicating account copy", () => {
  const livePromptMarkup = sourceBetween(
    homeSource,
    '<div class="admin-preview-popover account-required-popover"',
    '<div class="admin-preview-popover" id="adminPreviewPopover"',
  );

  for (const source of [livePromptMarkup, actionsSource]) {
    assert.match(source, /Free guest account/i);
    assert.match(source, /Follow your favorites/);
    assert.match(source, /Create free account/);
    assert.match(source, /Already have an account\? Sign in/);
    assert.doesNotMatch(source, /Create an account to continue/);
    assert.doesNotMatch(source, /Create a free guest account/);
  }

  assert.match(
    livePromptMarkup,
    /Create a free account to follow dancers, save profiles, and get updates\./,
  );
  assert.match(
    homeSource,
    /dataset\?\.feedAction[\s\S]*?Create a free account to follow dancers and get updates\./,
  );
  assert.match(
    homeSource,
    /dataset\?\.accountAction === "venue-follow"[\s\S]*?Create a free account to save clubs, follow favorites, and get updates\./,
  );
  assert.match(actionsSource, /type AccountAction = "follow";/);
  assert.doesNotMatch(actionsSource, /action === "notify"|requireCustomerAccount\("notify"\)/);
  assert.match(
    homeSource,
    /\.account-required-sheet \{[\s\S]*?gap: 10px;[\s\S]*?padding: 18px;/,
  );
  assert.match(
    homeSource,
    /\.account-required-actions a\.secondary-link \{[\s\S]*?min-height: 44px;[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;/,
  );
  assert.match(
    profilePageSource,
    /\.profile-account-gate-dialog \{ gap: 10px; padding: 19px; \}/,
  );
});

test("venue follows stay empty until a real customer session and remain account-scoped", () => {
  assert.match(
    homeSource,
    /const followedVenuesByCity = Object\.fromEntries\(\s+Object\.keys\(markets\)\.map\(\(city\) => \[city, \[\]\]\)\s+\);/,
  );
  assert.doesNotMatch(
    homeSource,
    /"Las Vegas": \["Spearmint Rhino Las Vegas", "Sapphire Las Vegas"\]/,
  );
  assert.match(
    homeSource,
    /function followedVenues\(city\) \{\s+if \(!isCustomerSession\(\)\) return \[\];/,
  );
  assert.match(
    homeSource,
    /function isFollowingVenue\(city, venueName\) \{\s+return Boolean\(\s+isCustomerSession\(\) &&\s+\(followedVenuesByCity\[city\] \|\| \[\]\)\.includes\(venueName\)/,
  );
  assert.match(
    homeSource,
    /function logoutAccount\(\{ message = "Logged out" \} = \{\}\) \{\s*void endAuthSession\(\);[\s\S]*?clearCustomerSavedCollections\(\);/,
  );

  assert.match(
    venueFollowsRouteSource,
    /const \{ client, user \} = await createRequestSupabaseContext\(request\);/,
  );
  assert.match(venueFollowsRouteSource, /customer_id: user\.id/);
});

test("public profiles keep Going visible and enable it for current or upcoming posted shifts", () => {
  assert.doesNotMatch(actionsSource, /if \(!token\) \{\s+return/);
  assert.doesNotMatch(actionsSource, /showSignedOutRequirements|Sign in required/);
  assert.match(actionsSource, /shifts\.find\(\(shift\) => shift\.isActive\) \|\| shifts\[0\] \|\| null/);
  assert.match(actionsSource, /<button[\s\S]*?profile-action-going[\s\S]*?\{isGoing \? "Going" : "I’m Going"\}/);
  assert.doesNotMatch(actionsSource, /<small className="profile-action-requirement">No shift posted<\/small>/);
  assert.match(actionsSource, /requireCustomerAccount\("follow"\)/);
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("notify"\)/);
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("report"\)/);
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("going"\)/);
  assert.match(actionsSource, /actionShift && updateGoing\(actionShift\.id\)/);
  assert.match(actionsSource, /const isGoing = Boolean\(actionShift && saved\.goingShiftIds\.includes\(actionShift\.id\)\)/);
  assert.match(actionsSource, /className=\{`\$\{actionShift \? "profile-action-available" : "profile-action-secondary"\} profile-action-going profile-action-icon-control\$\{isGoing \? " is-going" : ""\}\$\{!actionShift \? " profile-action-unavailable" : ""\}`\}/);
  assert.match(actionsSource, /aria-label=\{actionShift \? \(isGoing \? "Remove this shift from your plans" : "Add this shift to your plans"\)/);
  assert.match(actionsSource, /DancerProfileActionPreviewIcon type=\{isGoing \? "check" : "clock"\}/);
  assert.match(actionsSource, /disabled=\{actionShift \? !savedLoaded \|\| goingSaving : true\}/);
  assert.match(actionsSource, /<PublicReportReasonDialog/);
  assert.match(actionsSource, /onReason=\{\(reason\) => void submitReport\(reason\)\}/);
  assert.match(actionsSource, /aria-label="Close account prompt"/);
  assert.match(actionsSource, /href="\/account\?role=customer&mode=signup"/);
  assert.match(actionsSource, /href="\/account\?role=customer"/);
  assert.match(profilePageSource, /\.profile-account-gate, \.profile-report-gate, \.profile-schedule-gate \{ position: fixed; inset: 0; z-index: 1700/);
  assert.match(profilePageSource, /\.profile-action-requirement \{/);
});

test("the live mobile profile separates profile actions from venue travel actions", () => {
  const liveActionMarkup = sourceBetween(
    homeSource,
    "function profileActionButtonMarkup(icon, label)",
    "async function refreshProfileGoingState(profile)",
  );
  assert.match(homeSource, /function profileActionButtonMarkup\(icon, label\)/);
  assert.doesNotMatch(liveActionMarkup, /Sign in required|No sign-in needed|No shift posted|profile-action-requirement/);
  assert.doesNotMatch(liveActionMarkup, /"account"|"public"|"no-shift"/);
  assert.match(homeSource, /class="profile-header-report-toggle" id="reportBtn"/);
  assert.doesNotMatch(homeSource, /class="profile-modal-report-link"/);
  assert.doesNotMatch(homeSource, /id="profileActionOverflowToggle"|id="profileActionOverflowMenu"/);
  assert.doesNotMatch(homeSource, /data-profile-more-menu|data-profile-more-actions|data-profile-schedule-action/);
  assert.match(
    homeSource,
    /function liveProfileModalActionsMarkup\(profile, status\)[\s\S]*?const canMarkGoing = Boolean\(profile\?\.scheduled && profile\.shiftId\)[\s\S]*?const goingButton = canMarkGoing[\s\S]*?data-shift-state="unavailable"/,
  );
  assert.match(
    homeSource,
    /async function refreshProfileGoingState\(profile\) \{\s+if \(!profile\?\.shiftId \|\| window\.location\.protocol === "file:"\) return;/,
  );
  assert.match(homeSource, /data-shift-state="posted"/);
  assert.match(homeSource, /function dancerProfileUpcomingVenueDealMarkup\(profile, options = \{\}\)/);
  assert.match(homeSource, /data-upcoming-venue-deal="venue-page"/);
  assert.match(homeSource, /function dancerProfileTonightTravelActionsMarkup\(profile, options = \{\}\)/);
  assert.match(homeSource, /const actions = \[directionsMarkup, rideMarkup, venueDealMarkup\]\.filter\(Boolean\)/);
  assert.match(homeSource, /const statusClass = isWorkingTonight\(profile, city\) \? "is-working-now" : "is-upcoming";/);
  assert.match(homeSource, /profile-tonight-travel-actions \$\{statusClass\}\$\{dealLinkClass\}/);
  assert.match(homeSource, /\$\{shiftsMarkup\(profile, status,[\s\S]*?<div class="profile-tonight-deal">[\s\S]*?\$\{travelActionsMarkup\}/);
  assert.doesNotMatch(homeSource, /profileActionButtonMarkup\("car", "Ride", "working-now"\)/);
  assert.doesNotMatch(homeSource, /profileActionButtonMarkup\("pin", "Directions", "venue"\)/);
  assert.match(homeSource, /This dancer has no posted shift yet\./);
});

test("profile reports accept signed-out visitors and preserve optional signed-in attribution", () => {
  const reportHandler = sourceBetween(
    homeSource,
    'if (actionButton.id === "reportBtn")',
    "    });",
  );

  assert.match(reportHandler, /openContentReportDialog\(\{/);
  assert.doesNotMatch(reportHandler, /postAuthenticatedJson\("\/api\/reports"/);
  assert.match(homeSource, /async function submitContentReportDialog[\s\S]*?postOptionalAuthJson\("\/api\/reports"/);
  assert.match(actionsSource, /if \(token\) headers\.authorization = `Bearer \$\{token\}`/);
  assert.doesNotMatch(reportsRouteSource, /Sign in to submit a report/);
  assert.doesNotMatch(reportsRouteSource, /targetType !== "contact_message" && !reporterId/);
  assert.match(reportsRouteSource, /reporter_id: reporterId/);
});
