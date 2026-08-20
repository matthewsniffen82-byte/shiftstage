import assert from "node:assert/strict";
import test from "node:test";
import { successfulFinanceMutation } from "../src/lib/dancr/finance-admin-result.ts";

test("a successful finance refresh preserves the existing response contract", async () => {
  const finance = { metrics: { outstandingReceivablesCents: 1250 } };
  const response = await successfulFinanceMutation(async () => finance, { result: { processed: 1 } });

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      result: { processed: 1 },
      finance,
    },
  });
});

test("a failed post-write refresh never converts a completed mutation into an error", async () => {
  const refreshError = new Error("reporting unavailable");
  const logged = [];
  const response = await successfulFinanceMutation(
    async () => { throw refreshError; },
    { result: { processed: 1 } },
    (error) => logged.push(error),
  );

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      result: { processed: 1 },
      financeRefreshRequired: true,
    },
  });
  assert.deepEqual(logged, [refreshError]);
  assert.equal("error" in response.body, false);
  assert.equal("finance" in response.body, false);
});
