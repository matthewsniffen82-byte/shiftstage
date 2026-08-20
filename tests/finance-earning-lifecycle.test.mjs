import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EARNINGS_RELEASE_ROWS,
  releasePendingDancerEarnings,
} from "../src/lib/dancr/finance-earning-lifecycle.ts";

test("pending earnings release uses one bounded database transition", async () => {
  const calls = [];
  const client = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      return { data: 23, error: null };
    },
  };

  const released = await releasePendingDancerEarnings(client);

  assert.equal(released, 23);
  assert.deepEqual(calls, [{
    name: "release_pending_dancer_earnings",
    parameters: { p_limit: MAX_EARNINGS_RELEASE_ROWS },
  }]);
  assert.equal(MAX_EARNINGS_RELEASE_ROWS, 5_000);
});

test("pending earnings release never hides a database failure", async () => {
  const databaseError = new Error("release failed");
  const client = {
    async rpc() {
      return { data: null, error: databaseError };
    },
  };

  await assert.rejects(
    releasePendingDancerEarnings(client),
    (error) => error === databaseError,
  );
});
