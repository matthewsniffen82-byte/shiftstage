import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [input, dispatch] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-admin-input.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
]);

test("admin finance input rules use one dependency-free validation boundary", () => {
  assert.match(input, /export function parseAdminFinanceBody/);
  assert.match(dispatch, /const request = parseAdminFinanceBody\(input\)/);
  assert.match(dispatch, /if \(!request\.ok\) return invalid\(request\.error\)/);
  assert.match(dispatch, /const body = request\.value/);
  for (const parser of [
    "parseManualPaymentInput",
    "parsePayoutSettingsInput",
    "parseManageEarningInput",
    "parseRetryPayoutInput",
    "parseReconcileBitsafePayoutInput",
  ]) {
    assert.match(input, new RegExp(`export function ${parser}`));
    assert.match(dispatch, new RegExp(`${parser}\\(body\\)`));
  }
  assert.doesNotMatch(input, /SupabaseClient|\.from\(|\.rpc\(|finance-admin-actions|finance-reporting/);
  assert.doesNotMatch(dispatch, /function requiredText|function boundedInteger|function oneOf/);
});

test("typed parsers preserve provider, payout mode, and earning action allowlists", () => {
  assert.match(input, /\["stripe", "bitsafe", "adyen", "other"\] as const/);
  assert.match(input, /\["manual_cashout", "scheduled", "both"\] as const/);
  assert.match(input, /\["hold", "release", "reverse"\] as const/);
  assert.match(input, /payoutsEnabled: body\.payoutsEnabled === true/);
});

test("typed parsers preserve trimming, numeric bounds, and audit text limits", () => {
  assert.match(input, /typeof value !== "string" \|\| !value\.trim\(\)/);
  assert.match(input, /return value\.trim\(\)/);
  assert.match(input, /parsed < minimum \|\| parsed > maximum/);
  assert.match(input, /earningsHoldDays, 0, 90/);
  assert.match(input, /minimumPayoutCents, 1, 10_000_000/);
  assert.equal((input.match(/reason\.length < 3 \|\| reason\.length > 500/g) || []).length, 3);
  assert.match(input, /reconciliationReference\.length > 160/);
});

test("explicit validation failures remain dispatcher-owned 400 responses", () => {
  assert.match(input, /type ValidationResult<T>/);
  assert.match(input, /return \{ ok: false, error \}/);
  assert.equal((dispatch.match(/if \(!parsed\.ok\) return invalid\(parsed\.error\)/g) || []).length, 5);
  assert.match(input, /return invalid\("Invalid finance request\."\)/);
  assert.match(dispatch, /return \{ status: 400, body: \{ ok: false, error \} \}/);
});
