import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [actionsSource, profileSource, followRouteSource, mobileSource] = await Promise.all([
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer/follows/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("the public follower count is shared with the live follow controls", () => {
  assert.match(actionsSource, /export function DancerFollowStateProvider/);
  assert.match(actionsSource, /export function DancerFollowerCount/);
  assert.match(actionsSource, /export function DancerFollowerMetric/);
  assert.match(
    profileSource,
    /<DancerFollowStateProvider[\s\S]*?initialFollowerCount=\{profile\.followerCount\}[\s\S]*?key=\{profile\.id\}/,
  );
  assert.match(profileSource, /<DancerFollowerMetric \/>/);
  assert.match(actionsSource, /followerCount === 1 \? "Follower" : "Followers"/);
});

test("successful follow and unfollow responses update the visible follower count immediately", () => {
  const followHandler =
    actionsSource.match(/async function updateFollow[\s\S]*?\r?\n  }\r?\n\r?\n  async function updateNotifications/)?.[0] || "";

  assert.match(followHandler, /const data = await postAction\("\/api\/customer\/follows"/);
  assert.match(followHandler, /const following = typeof data\.following === "boolean" \? data\.following : requestedFollowing/);
  assert.match(followHandler, /const confirmedFollowerCount = readConfirmedFollowerCount\(data\)/);
  assert.match(followHandler, /setFollowerCount\(confirmedFollowerCount\)/);
  assert.match(actionsSource, /Number\.isSafeInteger\(count\)/);
});

test("failed or duplicate follow requests cannot change the visible count", () => {
  assert.match(actionsSource, /if \(!mountedRef\.current \|\| !savedLoaded \|\| followInFlightRef\.current\) return/);
  assert.match(actionsSource, /disabled=\{!savedLoaded \|\| followSaving\}/);
  assert.match(actionsSource, /const data = await postAction[\s\S]*?setFollowerCount\(confirmedFollowerCount\)/);
});

test("the follow API returns authoritative database follower and notification counts", () => {
  assert.match(followRouteSource, /createAdminSupabaseClient/);
  assert.match(followRouteSource, /const counts = await countDancerFollowPreferences\(dancerId\)/);
  assert.match(followRouteSource, /\.select\("customer_id", \{ count: "exact", head: true \}\)/);
  assert.match(followRouteSource, /\.eq\("notifications_enabled", true\)/);
  assert.match(followRouteSource, /followerCount: followers\.count \|\| 0/);
  assert.match(followRouteSource, /notificationCount: notifications\.count \|\| 0/);
  assert.match(followRouteSource, /notificationsEnabled: false,[\s\S]*\.\.\.counts/);
  assert.match(followRouteSource, /following: true, notificationsEnabled, \.\.\.counts/);
});

test("the signed-in live profile updates its visible follow metrics immediately and reconciles to the database", () => {
  const followHandler =
    mobileSource.match(/async function saveProfileFollow[\s\S]*?\r?\n    }\r?\n\r?\n    async function saveProfileNotifications/)?.[0] || "";
  const confirmedState =
    mobileSource.match(/function applyConfirmedProfileFollow[\s\S]*?\r?\n    }\r?\n\r?\n    async function saveProfileFollow/)?.[0] || "";

  assert.match(mobileSource, /id="modalFollowerCount" aria-live="polite"/);
  assert.match(mobileSource, /id="modalFollowerLabel">\$\{followerCount === 1 \? "Follower" : "Followers"\}/);
  assert.match(mobileSource, /id="modalProfileViews" aria-live="polite"/);
  assert.match(mobileSource, /async function loadLiveCustomerSaved\(\) \{\s+if \(!isCustomerSession\(\)\) return/);
  assert.match(followHandler, /const data = await postAuthenticatedJson\("\/api\/customer\/follows"/);
  assert.match(followHandler, /applyProfileFollowState\(profile, city, optimisticState\)/);
  assert.match(followHandler, /applyConfirmedProfileFollow\(profile, city, data\)/);
  assert.match(followHandler, /catch \(error\) \{\s+applyProfileFollowState\(profile, city, snapshot\)/);
  assert.match(followHandler, /actionButton\.disabled = true/);
  assert.match(followHandler, /finally \{[\s\S]*?actionButton\.disabled = false/);
  assert.match(confirmedState, /followerCount: confirmedFollowerCount\(/);
  assert.match(confirmedState, /notificationCount: confirmedNotificationCount\(/);
  assert.match(mobileSource, /followerCountEl\.textContent = followerCount\.toLocaleString\(\)/);
  assert.match(
    mobileSource,
    /const followerLabel = followerCount === 1 \? "Follower" : "Followers";[\s\S]*?followerLabelEl\.textContent = followerLabel/,
  );
  assert.doesNotMatch(mobileSource, /id="modalNotificationCount"/);
  assert.doesNotMatch(
    mobileSource.match(/function followerNumber[\s\S]*?\r?\n    }/)?.[0] || "",
    /isFollowingProfile/,
  );
});
