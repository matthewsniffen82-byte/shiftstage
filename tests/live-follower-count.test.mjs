import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [actionsSource, profileSource] = await Promise.all([
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
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
  assert.match(followHandler, /if \(following !== previousFollowing\)/);
  assert.match(followHandler, /adjustFollowerCount\(following \? 1 : -1\)/);
  assert.match(actionsSource, /Math\.max\(0, current \+ change\)/);
});

test("failed or duplicate follow requests cannot change the visible count", () => {
  assert.match(actionsSource, /if \(!savedLoaded \|\| followSaving\) return/);
  assert.match(actionsSource, /disabled=\{!savedLoaded \|\| followSaving\}/);
  assert.match(actionsSource, /const data = await postAction[\s\S]*?adjustFollowerCount\(following \? 1 : -1\)/);
});
