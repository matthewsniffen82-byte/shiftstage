import assert from "node:assert/strict";
import test from "node:test";

import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";

test("unexpected server failures return the public fallback instead of internal details", async () => {
  const result = resolveApiError(
    new Error('relation "private_finance_table" does not exist'),
    "Unable to load finance.",
  );
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, error: "Unable to load finance." });
  assert.equal(result.shouldLog, true);
});

test("database details remain hidden even when a legacy route supplies a client status", async () => {
  const result = resolveApiError(
    new Error('duplicate key violates unique constraint "secret_index"'),
    "Unable to save this request.",
    400,
  );
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { ok: false, error: "Unable to save this request." });
});

test("intentional typed public errors preserve safe actionable feedback", async () => {
  const result = resolveApiError(
    new PublicApiError("CONFLICT", "This Club Deal was already redeemed.", 409),
    "Unable to redeem this Club Deal.",
  );
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    ok: false,
    error: "This Club Deal was already redeemed.",
    code: "CONFLICT",
  });
});

test("untyped client-status errors cannot expose provider-like messages", async () => {
  const result = resolveApiError(new Error("Choose a valid city."), "Unable to choose this city.", 400);
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { ok: false, error: "Unable to choose this city." });
  assert.equal(result.shouldLog, true);
});
