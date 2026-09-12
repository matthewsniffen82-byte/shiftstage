import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [provisioning, signupRoute, callbackRoute] = await Promise.all([
  readFile(new URL("../src/lib/dancr/account-provisioning.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
]);

test("signup and email confirmation share one atomic account provisioning boundary", () => {
  for (const source of [signupRoute, callbackRoute]) {
    assert.match(source, /provisionAppAccount/);
    assert.doesNotMatch(source, /\.from\("app_users"\)|\.from\("customer_profiles"\)|\.from\("dancer_profiles"\)/);
  }
  assert.match(provisioning, /import "server-only"/);
  assert.match(provisioning, /\.rpc\("provision_app_account_safely"/);
  assert.doesNotMatch(provisioning, /\.from\(|isMissingSupabaseFunction|existingDancerLogEvent/);
});
