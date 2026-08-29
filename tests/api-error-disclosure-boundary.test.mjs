import assert from "node:assert/strict";
import test from "node:test";

import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";

test("safe-looking upstream failures remain private at every legacy client status", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    const result = resolveApiError(
      new Error("Remote provider account lookup failed for customer acct_private"),
      "Unable to complete this request.",
      status,
    );
    assert.equal(result.status, status);
    assert.equal(result.body.error, "Unable to complete this request.");
    assert.equal(result.shouldLog, true);
  }
});

test("only explicitly typed errors may publish new actionable messages", () => {
  const result = resolveApiError(
    new PublicApiError("INVALID_REQUEST", "Choose a valid city.", 400),
    "Unable to choose this city.",
  );
  assert.deepEqual(result.body, {
    ok: false,
    error: "Choose a valid city.",
    code: "INVALID_REQUEST",
  });
  assert.equal(result.shouldLog, false);
});
