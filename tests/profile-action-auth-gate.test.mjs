import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, actionsSource, profilePageSource, reportsRouteSource, profileNavigationSource, venueActionsSource, venueFollowsRouteSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/ProfileNavigationActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/VenueProfileActions.tsx", import.meta.url), "utf8"),
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
    'modalBody.addEventListener("click"',
    'const modalCloseButton = document.getElementById("modalClose")',
  );

  assert.match(handler, /#followBtn, #notifyBtn, #goingBtn, #reportBtn/);
  assert.match(
    handler,
    /\(actionButton\.id === "followBtn" \|\| actionButton\.id === "notifyBtn"\) &&\s+!requireCustomerAccountForProfileAction\(actionButton\)/,
  );
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
    /#profileBackdrop\.modal-backdrop\.show \{\s+z-index: 140 !important;[\s\S]*?#profileBackdrop #modalClose \{[\s\S]*?position: fixed !important;[\s\S]*?z-index: 221 !important;[\s\S]*?pointer-events: auto !important;/,
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
    /@media \(max-width: 720px\) \{[\s\S]*?#profileBackdrop \.profile-modal \{[\s\S]*?--profile-report-clearance: max\(16px, env\(safe-area-inset-bottom, 0px\)\);[\s\S]*?scroll-padding-bottom: var\(--profile-report-clearance\) !important;[\s\S]*?#profileBackdrop \.modal-actions \{[\s\S]*?padding-bottom: 0 !important;[\s\S]*?#profileBackdrop \.modal-grid \{[\s\S]*?padding-bottom: var\(--profile-report-clearance\) !important;/,
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

test("venue follows are empty and unavailable until a real customer session is active", () => {
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
    /function logoutAccount\(\{ message = "Logged out" \} = \{\}\) \{[\s\S]*?saveAuthSession\(null\);\s+clearCustomerSavedCollections\(\);/,
  );

  assert.match(venueActionsSource, /const \[following, setFollowing\] = useState\(false\)/);
  assert.match(
    venueActionsSource,
    /if \(!accessToken\) \{\s+setFollowing\(false\);\s+setNotificationsEnabled\(false\);\s+return;/,
  );
  assert.match(
    venueActionsSource,
    /response\.status === 401 \|\| response\.status === 403[\s\S]*?setToken\(""\);\s+setFollowing\(false\);\s+setNotificationsEnabled\(false\);/,
  );
  assert.match(venueActionsSource, /if \(!requireCustomer\(\) \|\| isSaving\) return;/);
  assert.match(venueActionsSource, /session\?\.account\?\.role === "customer"/);

  assert.match(
    venueFollowsRouteSource,
    /const \{ client, user \} = await createRequestSupabaseContext\(request\);/,
  );
  assert.match(venueFollowsRouteSource, /customer_id: user\.id/);
});

test("public profiles keep Going visible for the next posted shift and gate only Follow and Notify", () => {
  assert.doesNotMatch(actionsSource, /if \(!token\) \{\s+return/);
  assert.match(actionsSource, /showSignedOutRequirements = savedLoaded && !token/);
  assert.match(actionsSource, /profile-action-requirement">Sign in required/);
  assert.match(actionsSource, /shifts\.find\(\(shift\) => shift\.isActive\) \|\| shifts\[0\] \|\| null/);
  assert.match(actionsSource, /\? `\$\{actionShift\.isActive \? "Working now" : actionShift\.label\} · No sign-in needed`/);
  assert.match(actionsSource, /: "No shift posted"/);
  for (const action of ["follow", "notify"]) {
    assert.match(
      actionsSource,
      new RegExp(`requireCustomerAccount\\("${action}"\\)`),
    );
  }
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("report"\)/);
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("going"\)/);
  assert.match(actionsSource, /if \(actionShift\) updateGoing\(actionShift\.id\)/);
  assert.match(actionsSource, /const isGoing = Boolean\(actionShift && saved\.goingShiftIds\.includes\(actionShift\.id\)\)/);
  assert.match(actionsSource, /\{isGoing \? "Going" : "I’m Going"\}/);
  assert.match(actionsSource, /disabled=\{!actionShift \|\| !savedLoaded \|\| goingSaving\}/);
  assert.match(actionsSource, /onClick=\{submitReport\}/);
  assert.match(actionsSource, /role="dialog"\s+aria-modal="true"/);
  assert.match(actionsSource, /aria-label="Close account prompt"/);
  assert.match(actionsSource, /href="\/account\?role=customer&mode=signup"/);
  assert.match(actionsSource, /href="\/account\?role=customer"/);
  assert.match(profilePageSource, /\.profile-account-gate, \.profile-report-gate \{ position: fixed; inset: 0; z-index: 1700/);
  assert.match(profilePageSource, /\.profile-action-requirement \{/);
});

test("the live mobile profile labels protected actions, keeps Going public, and places public reporting under More", () => {
  assert.match(homeSource, /function profileActionRequirementMarkup\(requirement\)/);
  assert.match(homeSource, /Sign in required/);
  assert.match(homeSource, /No sign-in needed/);
  assert.match(
    homeSource,
    /profileActionButtonMarkup\([^)]*"account"[^)]*\)/,
  );
  assert.match(
    homeSource,
    /data-profile-more-menu role="menu" hidden>[\s\S]*?id="reportBtn" type="button" role="menuitem"[\s\S]*?Report profile/,
  );
  assert.match(
    homeSource,
    /function liveProfileModalActionsMarkup\(profile, status\)[\s\S]*?const canMarkGoing = Boolean\(profile\.shiftId\)[\s\S]*?No shift posted/,
  );
  assert.match(
    homeSource,
    /async function refreshProfileGoingState\(profile\) \{\s+if \(!profile\?\.shiftId \|\| window\.location\.protocol === "file:"\) return;/,
  );
  assert.match(homeSource, /data-shift-state="posted"/);
  assert.match(homeSource, /This dancer has no posted shift yet\./);
});

test("profile reports accept signed-out visitors and preserve optional signed-in attribution", () => {
  const reportHandler = sourceBetween(
    homeSource,
    'if (actionButton.id === "reportBtn")',
    "    });",
  );

  assert.match(reportHandler, /await postOptionalAuthJson\("\/api\/reports"/);
  assert.doesNotMatch(reportHandler, /postAuthenticatedJson\("\/api\/reports"/);
  assert.match(actionsSource, /if \(token\) headers\.authorization = `Bearer \$\{token\}`/);
  assert.doesNotMatch(reportsRouteSource, /Sign in to submit a report/);
  assert.doesNotMatch(reportsRouteSource, /targetType !== "contact_message" && !reporterId/);
  assert.match(reportsRouteSource, /reporter_id: reporterId/);
});
