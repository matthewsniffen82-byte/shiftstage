import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const followRouteSource = readFileSync(
  new URL("../app/api/customer/follows/route.ts", import.meta.url),
  "utf8",
);

function sourceBetween(start, end) {
  const match = homeSource.match(new RegExp(`${start}[\\s\\S]*?${end}`));
  assert.ok(match, `Expected source between ${start} and ${end}`);
  return match[0];
}

test("only customer sessions load persisted customer profile action state", () => {
  const discoveryLoader = sourceBetween(
    "async function loadLiveDiscovery",
    "async function refreshPublicDiscoveryAfterAdminReview",
  );
  const confirmedSession = sourceBetween(
    "function openConfirmedSessionDashboard",
    "function restoreAuthConfirmationResume",
  );

  assert.match(homeSource, /async function loadLiveProfileActionState\(\) \{\s+if \(!isCustomerSession\(\)\) return/);
  assert.match(discoveryLoader, /if \(isCustomerSession\(\)\) await loadLiveCustomerSaved\(\)/);
  assert.doesNotMatch(discoveryLoader, /authSession\?\.accessToken\) await loadLiveProfileActionState\(\)/);
  assert.doesNotMatch(confirmedSession, /dashboardRole === "dancer"\) loadLiveProfileActionState\(\)/);
  assert.match(homeSource, /function applyLiveProfileActions\(saved\)[\s\S]*saved\?\.follows[\s\S]*saved\?\.goingSignals/);
});

test("Follow and Notify update visible counts immediately, confirm exact database counts, and roll back on failure", () => {
  const followHandler = sourceBetween(
    "async function saveProfileFollow",
    "async function saveProfileNotifications",
  );
  const notifyHandler = sourceBetween(
    "async function saveProfileNotifications",
    "modalBody\\.addEventListener",
  );

  assert.match(homeSource, /id="modalFollowerCount" aria-live="polite"/);
  assert.match(homeSource, /id="modalProfileViews" aria-live="polite"/);
  assert.match(homeSource, /function optimisticProfileFollowState\(/);
  assert.match(homeSource, /function applyConfirmedProfileFollow[\s\S]*confirmedFollowerCount[\s\S]*confirmedNotificationCount/);
  assert.ok(
    followHandler.indexOf("applyProfileFollowState(profile, city, optimisticState)") <
      followHandler.indexOf('await postAuthenticatedJson("/api/customer/follows"'),
    "Follow must render its optimistic count before waiting for the API",
  );
  assert.match(followHandler, /catch \(error\) \{\s+applyProfileFollowState\(profile, city, snapshot\)/);
  assert.ok(
    notifyHandler.indexOf("applyProfileFollowState(profile, city, optimisticState)") <
      notifyHandler.indexOf('await postAuthenticatedJson("/api/customer/follows"'),
    "Notify must render its optimistic count before waiting for the API",
  );
  assert.match(notifyHandler, /catch \(error\) \{\s+applyProfileFollowState\(profile, city, snapshot\)/);
});

test("follow API returns authoritative follower and notification subscriber counts", () => {
  assert.match(followRouteSource, /countDancerFollowPreferences/);
  assert.match(followRouteSource, /\.eq\("notifications_enabled", true\)/);
  assert.match(followRouteSource, /followerCount: followers\.count \|\| 0/);
  assert.match(followRouteSource, /notificationCount: notifications\.count \|\| 0/);
  assert.match(followRouteSource, /notificationsEnabled: false,[\s\S]*\.\.\.counts/);
  assert.match(followRouteSource, /following: true, notificationsEnabled, \.\.\.counts/);
});

test("I'm Going changes the visible count before the request and reconciles or rolls back", () => {
  assert.match(
    homeSource,
    /<button class="action-btn going-btn profile-action-icon-control secondary[\s\S]*?id="goingBtn" type="button"[\s\S]*?aria-pressed="\$\{isGoingTonight\}"/,
  );
  assert.doesNotMatch(
    homeSource,
    /hasPrimaryDeal \? "secondary" : "is-primary-action"/,
  );
  const goingHandler = sourceBetween(
    "async function saveProfileGoing",
    "modalBody\\.addEventListener",
  );

  assert.ok(
    goingHandler.indexOf("profile.goingCount = optimisticCount") <
      goingHandler.indexOf('await postOptionalAuthJson("/api/customer/going"'),
    "Going must render its optimistic count before waiting for the API",
  );
  assert.match(goingHandler, /profile\.goingCount = realCount/);
  assert.match(goingHandler, /actionButton\.setAttribute\("aria-pressed", String\(requestedGoing\)\)/);
  assert.match(goingHandler, /actionButton\.setAttribute\("aria-pressed", String\(savedGoing\)\)/);
  assert.match(goingHandler, /actionButton\.setAttribute\("aria-pressed", String\(wasGoing\)\)/);
  assert.match(goingHandler, /if \(!Number\.isSafeInteger\(realCount\) \|\| realCount < 0\)/);
  assert.match(goingHandler, /catch \(error\) \{[\s\S]*profile\.goingCount = previousCount/);
  assert.match(
    homeSource,
    /if \(actionButton\.id === "goingBtn"\) \{\s+await saveProfileGoing\(actionButton\)/,
  );
  assert.match(
    homeSource,
    /function homeFeedGoingActionMarkup\(profile, active\) \{[\s\S]*?tonightInterestCount\(profile\)[\s\S]*?feed-card-action-count[\s\S]*?compactNumber\(count\)/,
  );
  assert.match(
    homeSource,
    /if \(action === "going"\) \{[\s\S]*?button\.innerHTML = homeFeedGoingActionMarkup\(profile, active\)/,
  );
});
