import assert from "node:assert/strict";
import test from "node:test";
import { PublicApiError } from "../src/lib/api-error-policy.ts";
import { optionalAuthHarness, verifiedUserId } from "./helpers/optional-auth-fixture.mjs";

const kinds = ["going", "activity", "analytics", "report", "cashier"];
for (const kind of kinds) {
  for (const authError of [{ status: 503 }, { status: 408 }, { status: 429 }, { status: 0 }, { message: "synthetic private failure" }, { name: "AuthRetryableFetchError" }]) {
    test(kind + " does not write anonymously when Auth cannot verify the account: " + JSON.stringify(authError), async () => {
      const h = optionalAuthHarness(kind, { authError });
      const response = await h.run();
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(body), /synthetic private/);
      assert.equal(h.writes.length, 0);
      assert.equal(h.authCalls.length, 1);
    });
  }
  test(kind + " preserves an unknown thrown provider failure without writing", async () => {
    const h = optionalAuthHarness(kind, { authThrow: new TypeError("synthetic network detail") });
    const response = await h.run();
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /synthetic network/);
    assert.equal(h.writes.length, 0);
  });
  for (const options of [{ bearer: false }, { authError: { status: 401 } }, { noUser: true }]) {
    test(kind + " retains its public guest action for " + JSON.stringify(options), async () => {
      const h = optionalAuthHarness(kind, options), response = await h.run(options);
      assert.equal(response.status, 200);
      assert.equal(h.writes.length, 1);
      const write = h.writes[0];
      assert.equal(write.value ? write.value.viewer_id ?? write.value.reporter_id ?? null : write.identity, null);
      assert.equal(h.authCalls.length, options.bearer === false ? 0 : 1);
    });
  }
  test(kind + " associates only the provider-verified account", async () => {
    const h = optionalAuthHarness(kind), response = await h.run();
    assert.equal(response.status, 200);
    assert.equal(h.writes.length, 1);
    const write = h.writes[0];
    assert.equal(write.value ? write.value.viewer_id || write.value.reporter_id : write.identity, verifiedUserId);
    for (const query of h.queries.filter(q => q.table === "app_users")) {
      assert.deepEqual(query.filters, [["id", verifiedUserId]]);
    }
  });
}
for (const kind of ["cashier", "activity"]) {
  for (const accountError of [{ code: "57014" }, { code: "42501" }, { code: "PGRST116" }]) {
    test(kind + " stops on an account-query failure instead of erasing identity: " + accountError.code, async () => {
      const h = optionalAuthHarness(kind, { accountError }), response = await h.run();
      assert.equal(response.status, accountError.code === "57014" ? 503 : 500);
      assert.equal(h.writes.length, 0);
    });
  }
  for (const options of [{ noAccount: true }, { state: "suspended" }]) {
    test(kind + " retains its existing eligibility rule for " + JSON.stringify(options), async () => {
      const h = optionalAuthHarness(kind, options), response = await h.run();
      assert.equal(response.status, 200);
      assert.equal(h.writes[0].identity, null);
    });
  }
}
test("Going GET does not return a guest's empty state during an auth outage", async () => {
  const h = optionalAuthHarness("going", { authError: { status: 503 } });
  const response = await h.run({ method: "GET" });
  assert.equal(response.status, 503);
  assert.equal(h.queries.some(q => q.table === "going_signals"), false);
  assert.equal(response.headers.has("set-cookie"), false);
});
test("only a definitive sign-in-required error permits an anonymous fallback", () => {
  const { requestApi } = optionalAuthHarness("going");
  for (const error of [new Error("Sign in required."), new PublicApiError("AUTH_REQUIRED", "Sign in again.", 401)]) {
    assert.equal(requestApi.isRequestAuthenticationRequired(error), true);
  }
  for (const error of [new PublicApiError("FORBIDDEN", "Sign in required.", 403), new PublicApiError("UNAVAILABLE", "Temporary failure.", 503), { status: 401 }, new Error("Private detail")]) {
    assert.equal(requestApi.isRequestAuthenticationRequired(error), false);
  }
});
