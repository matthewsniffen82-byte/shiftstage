import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [provisioning, signupRoute, callbackRoute] = await Promise.all([
  readFile(new URL("../src/lib/dancr/account-provisioning.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
]);

test("signup and email confirmation share one account provisioning boundary", () => {
  for (const source of [signupRoute, callbackRoute]) {
    assert.match(source, /provisionAppAccount/);
    assert.doesNotMatch(source, /\.from\("app_users"\)/);
    assert.doesNotMatch(source, /\.from\("customer_profiles"\)/);
    assert.doesNotMatch(source, /\.from\("dancer_profiles"\)/);
  }

  assert.match(provisioning, /export async function provisionAppAccount/);
  assert.match(provisioning, /\.from\("app_users"\)\.upsert/);
  assert.match(provisioning, /\.from\("customer_profiles"\)\.upsert/);
  assert.match(provisioning, /\.from\("dancer_profiles"\)\.insert/);
});

test("new dancer accounts start with explicit blank identity fields and private draft state", () => {
  const dancerInsert = provisioning.match(
    /\.from\("dancer_profiles"\)\.insert\(\{[\s\S]*?\n  \}\);/,
  )?.[0] || "";

  assert.match(provisioning, /input\.role === "dancer" \? "Dancer" : input\.displayName/);
  assert.match(dancerInsert, /real_name: null/);
  assert.match(dancerInsert, /stage_name: ""/);
  assert.match(dancerInsert, /city: input\.city/);
  assert.match(dancerInsert, /initialDancerApprovalValues\(\)/);
  assert.doesNotMatch(dancerInsert, /input\.email|input\.displayName|Las Vegas/);
});

test("account provisioning preserves every existing dancer profile", () => {
  const existingProfileBranch = provisioning.match(
    /if \(existingProfile\) \{[\s\S]*?\n  \}/,
  )?.[0] || "";

  assert.match(existingProfileBranch, /return/);
  assert.doesNotMatch(existingProfileBranch, /\.update\(|\.upsert\(|status:\s*"draft"|is_public\s*:/);
  assert.doesNotMatch(provisioning, /account_state/);
});
