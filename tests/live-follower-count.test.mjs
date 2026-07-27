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
  assert.match(profileSource, /<DancerFollowStateProvider initialFollowerCount=\{profile\.followerCount\} key=\{profile\.id\}>/);
  assert.match(profileSource, /<dt>Followers<\/dt>[\s\S]*?<DancerFollowerCount \/>/);
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
  assert.match(actionsSource, /if \(!savedLoaded \|\| followSaving\) return/);
  assert.match(actionsSource, /disabled=\{!savedLoaded \|\| followSaving\}/);
  assert.match(actionsSource, /const data = await postAction[\s\S]*?setFollowerCount\(confirmedFollowerCount\)/);
});

test("the follow API returns the authoritative database follower count", () => {
  assert.match(followRouteSource, /createAdminSupabaseClient/);
  assert.match(followRouteSource, /const followerCount = await countDancerFollowers\(dancerId\)/);
  assert.match(followRouteSource, /\.select\("customer_id", \{ count: "exact", head: true \}\)/);
  assert.match(followRouteSource, /following: false, notificationsEnabled: false, followerCount/);
  assert.match(followRouteSource, /following: true, notificationsEnabled, followerCount/);
});

test("the signed-in live profile updates its visible follower metric from the saved database result", () => {
  const followHandler =
    mobileSource.match(/async function saveProfileFollow[\s\S]*?\r?\n    }\r?\n\r?\n    async function saveProfileNotifications/)?.[0] || "";
  const confirmedState =
    mobileSource.match(/function applyConfirmedProfileFollow[\s\S]*?\r?\n    }\r?\n\r?\n    async function saveProfileFollow/)?.[0] || "";

  assert.match(mobileSource, /id="modalFollowerCount" aria-live="polite"/);
  assert.match(mobileSource, /async function loadLiveCustomerSaved\(\) \{\s+if \(!authSession\?\.accessToken\) return/);
  assert.match(followHandler, /const data = await postAuthenticatedJson\("\/api\/customer\/follows"/);
  assert.match(followHandler, /applyConfirmedProfileFollow\(profile, city, data\)/);
  assert.match(followHandler, /actionButton\.disabled = true/);
  assert.match(followHandler, /finally \{[\s\S]*?actionButton\.disabled = false/);
  assert.match(confirmedState, /profile\.followerCount = confirmedFollowerCount\(/);
  assert.match(confirmedState, /followerCountEl\.innerHTML = followerMetricMarkup\(profile, city\)/);
  assert.doesNotMatch(
    mobileSource.match(/function followerNumber[\s\S]*?\r?\n    }/)?.[0] || "",
    /isFollowingProfile/,
  );
});
