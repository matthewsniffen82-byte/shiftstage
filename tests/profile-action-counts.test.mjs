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

test("signed-in dancer sessions load their existing profile action state", () => {
  const discoveryLoader = sourceBetween(
    "async function loadLiveDiscovery",
    "async function refreshPublicDiscoveryAfterAdminReview",
  );
  const confirmedSession = sourceBetween(
    "function openConfirmedSessionDashboard",
    "function restoreAuthConfirmationResume",
  );

  assert.match(homeSource, /async function loadLiveProfileActionState\(\) \{\s+if \(!authSession\?\.accessToken\) return/);
  assert.match(discoveryLoader, /else if \(authSession\?\.accessToken\) await loadLiveProfileActionState\(\)/);
  assert.match(confirmedSession, /if \(dashboardRole === "dancer"\) loadLiveProfileActionState\(\)/);
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
  assert.match(homeSource, /id="modalNotificationCount" aria-live="polite"/);
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
  const goingHandler = sourceBetween(
    'if \\(actionButton\\.id === "goingBtn"\\)',
    'if \\(actionButton\\.id === "reportBtn"\\)',
  );

  assert.ok(
    goingHandler.indexOf("profile.goingCount = optimisticCount") <
      goingHandler.indexOf('await postAuthenticatedJson("/api/customer/going"'),
    "Going must render its optimistic count before waiting for the API",
  );
  assert.match(goingHandler, /profile\.goingCount = realCount/);
  assert.match(goingHandler, /if \(!Number\.isSafeInteger\(realCount\) \|\| realCount < 0\)/);
  assert.match(goingHandler, /catch \(error\) \{[\s\S]*profile\.goingCount = previousCount/);
});
