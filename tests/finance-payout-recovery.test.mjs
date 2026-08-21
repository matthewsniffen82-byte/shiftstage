import assert from "node:assert/strict";
import test from "node:test";
import { releaseFailedDancerPayoutBatch } from "../src/lib/dancr/finance-payout-recovery.ts";

test("failed payout recovery releases the reserved batch for retry", async () => {
  const calls = [];
  const client = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      return { data: { released: true }, error: null };
    },
  };

  const result = await releaseFailedDancerPayoutBatch(client, "batch-123", "Provider unavailable");

  assert.deepEqual(result, { released: true });
  assert.deepEqual(calls, [{
    name: "release_dancer_payout_batch",
    parameters: {
      p_batch_id: "batch-123",
      p_status: "failed",
      p_failure_message: "Provider unavailable",
    },
  }]);
});

test("failed payout recovery never hides a database failure", async () => {
  const databaseError = new Error("release failed");
  const client = {
    async rpc() {
      return { data: null, error: databaseError };
    },
  };

  await assert.rejects(
    releaseFailedDancerPayoutBatch(client, "batch-123", "Provider unavailable"),
    (error) => error === databaseError,
  );
});
