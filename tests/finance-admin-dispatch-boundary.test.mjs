import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dispatch, route] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
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
    "reconcile_bitsafe_payout",
  ]) {
    assert.match(dispatch, new RegExp(`body\\.action === "${action}"`));
  }
  assert.match(dispatch, /return invalid\("Unsupported finance action\."\)/);
});

test("the dispatcher preserves validation limits and explicit client errors", () => {
  assert.match(dispatch, /totalPaidCents <= 0/);
  assert.match(dispatch, /Payment total must be a positive whole number of cents\./);
  assert.match(dispatch, /boundedInteger\(body\.earningsHoldDays, 0, 90/);
  assert.match(dispatch, /boundedInteger\(body\.minimumPayoutCents, 1, 10_000_000/);
  assert.equal((dispatch.match(/reason\.length < 3 \|\| reason\.length > 500/g) || []).length, 3);
  assert.match(dispatch, /reconciliationReference\.length > 160/);
  assert.match(dispatch, /return \{ status: 400, body: \{ ok: false, error \} \}/);
});

test("successful writes still refresh the full admin finance overview", () => {
  assert.match(dispatch, /return \{ status: 200, body: \{ ok: true, \.\.\.body \} \}/);
  assert.equal((dispatch.match(/finance: await getAdminFinanceOverview\(client\)/g) || []).length, 7);
  assert.match(dispatch, /updatePayoutSettings\(client, adminUserId/);
  assert.match(dispatch, /manageDancerEarning\(client, adminUserId/);
  assert.match(dispatch, /retryDancerPayout\(client, adminUserId/);
  assert.match(dispatch, /reconcileBitsafePayout\(client, adminUserId/);
});
