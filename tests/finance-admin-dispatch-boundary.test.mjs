import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dispatch, input, route] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-input.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/finance/route.ts", import.meta.url), "utf8"),
]);

test("admin finance transport authenticates before delegating one parsed request", () => {
  assert.match(route, /await requireAdmin\(client, user\.id\)/);
  assert.match(route, /const body = await request\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(route, /dispatchAdminFinanceAction\(admin, user\.id, body\)/);
  assert.match(route, /NextResponse\.json\(result\.body, \{ status: result\.status \}\)/);
  assert.doesNotMatch(route, /body\.action ===/);
  assert.doesNotMatch(route, /recordManualClubInvoicePayment|processDancerPayouts|runQrFinanceAutomation/);
});

test("the dispatcher preserves every supported production finance action", () => {
  for (const action of [
    "run_automation",
    "process_payouts",
    "record_manual_payment",
    "update_payout_settings",
    "manage_earning",
    "retry_payout",
    "verify_nats_affiliate",
    "disable_nats_affiliate",
    "retry_nats_export",
    "reconcile_nats_export",
  ]) {
    assert.match(input, new RegExp(`"${action}"`));
    assert.match(dispatch, new RegExp(`command\\.action === "${action}"`));
  }
  assert.doesNotMatch(dispatch, /body\.action ===/);
  assert.match(dispatch, /parseAdminFinanceCommand\(input\)/);
  assert.match(input, /parseAdminFinanceAction\(body\)/);
  assert.match(dispatch, /return unsupportedCommand\(command\)/);
  assert.match(dispatch, /function unsupportedCommand\(command: never\)/);
  assert.match(input, /function unsupportedAction\(action: never\)/);
  assert.match(dispatch, /return invalid\("Unsupported finance action\."\)/);
});

test("the dispatcher preserves validation limits and explicit client errors", () => {
  assert.match(input, /parseAdminFinanceBody\(input\)/);
  assert.match(dispatch, /if \(!parsed\.ok\) return invalid\(parsed\.error\)/);
  assert.match(input, /Number\.isSafeInteger\(parsed\)/);
  assert.match(input, /Number\.MAX_SAFE_INTEGER/);
  assert.match(input, /Payment total must be a positive whole number of cents\./);
  assert.match(input, /const UUID_PATTERN/);
  assert.match(input, /Payment reference must be 160 characters or fewer\./);
  assert.match(input, /boundedInteger\(body\.earningsHoldDays, 0, 90/);
  assert.match(input, /boundedInteger\(body\.minimumPayoutCents, 1, 10_000_000/);
  assert.equal((input.match(/reason\.value\.length < 3 \|\| reason\.value\.length > 500/g) || []).length, 2);
  assert.match(dispatch, /return \{ status: 400, body: \{ ok: false, error \} \}/);
});

test("successful writes still refresh the full admin finance overview", () => {
  assert.match(dispatch, /return \{ status: 200, body: \{ ok: true, \.\.\.body \} \}/);
  assert.equal((dispatch.match(/finance: await getAdminFinanceOverview\(client\)/g) || []).length, 10);
  assert.match(dispatch, /recordManualClubInvoicePayment\(client, command\)/);
  assert.match(dispatch, /updatePayoutSettings\(client, adminUserId, command\)/);
  assert.match(dispatch, /manageDancerEarning\(client, adminUserId, command\)/);
  assert.match(dispatch, /retryDancerPayout\(client, adminUserId, command\)/);
  assert.match(dispatch, /verifyNatsAffiliateLink\(client, adminUserId, command\.dancerId, command\.reason\)/);
  assert.match(dispatch, /disableNatsAffiliateLink\(client, adminUserId, command\.dancerId, command\.reason\)/);
  assert.match(dispatch, /retryFailedNatsCommissionExport\(client, adminUserId, command\.exportId, command\.reason\)/);
  assert.match(dispatch, /reconcileNatsCommissionExport\(client, adminUserId, command\.exportId, command\.resolution, command\.reason\)/);
  assert.doesNotMatch(dispatch, /bitsafe|yoursafe|reconcileBitsafe/i);
});
