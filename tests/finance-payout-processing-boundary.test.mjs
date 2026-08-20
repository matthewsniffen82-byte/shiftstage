import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [processing, finance, adminDispatch] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-payout-processing.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
]);

test("dancer payout dispatch uses one dedicated processing boundary", () => {
  assert.match(finance, /from "\.\/finance-payout-processing"/);
  assert.match(adminDispatch, /from "\.\/finance-payout-processing"/);
  assert.match(processing, /export async function processDancerPayouts/);
  assert.doesNotMatch(finance, /export async function processDancerPayouts/);
  assert.doesNotMatch(finance, /async function createScheduledPayoutRequests/);
});

test("processing remains disabled until every production payout gate is enabled", () => {
  assert.match(processing, /from "\.\/finance-earning-lifecycle"/);
  assert.match(processing, /await releasePendingDancerEarnings\(client\)/);
  assert.doesNotMatch(processing, /rpc\("release_pending_dancer_earnings"/);
  assert.match(processing, /await getEffectivePayoutSettings\(client\)/);
  assert.match(processing, /if \(!settings\.payoutsEnabled\)/);
  assert.match(processing, /payoutAccount\.payout_eligibility !== "eligible"/);
  assert.match(processing, /payoutAccount\.verification_status !== "verified"/);
  assert.match(processing, /eq\("is_test", false\)/);
});

test("provider dispatch preserves reservation and idempotency safeguards", () => {
  assert.match(processing, /const dispatchKey = `mydancr-payout-\$\{batch\.id\}`/);
  assert.match(processing, /batch\.status === "processing" && !isDispatchRetry/);
  assert.match(processing, /rpc\("mark_dancer_payout_processing"/);
  assert.match(processing, /idempotencyKey: dispatchKey/);
  assert.match(processing, /p_provider_reference_id: transfer\.providerReferenceId/);
});

test("dispatch failures remain recoverable and financially audited", () => {
  assert.match(processing, /rpc\("flag_dancer_payout_dispatch_review"/);
  assert.match(processing, /rpc\("release_dancer_payout_batch"/);
  assert.doesNotMatch(processing, /bitsafe|yoursafe/i);
});

test("scheduled payout creation preserves eligible unheld ledger selection", () => {
  assert.match(processing, /eq\("status", "available"\)/);
  assert.match(processing, /is\("payout_batch_id", null\)/);
  assert.match(processing, /is\("held_at", null\)\.is\("review_flag", null\)/);
  assert.match(processing, /if \(amount < minimumPayoutCents\) continue/);
  assert.match(processing, /rpc\("create_dancer_payout_batch"/);
  assert.match(processing, /String\(batchError\.code\) !== "23505"/);
});
