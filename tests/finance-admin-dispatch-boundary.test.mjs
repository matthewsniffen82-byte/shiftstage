import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminClient, dispatch, input, result, route] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-input.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-result.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/finance/route.ts", import.meta.url), "utf8"),
]);

test("retired admin finance transport authorizes without dispatching financial actions", () => {
  assert.match(route, /await requireAdmin\(client, user\.id\)/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /dispatchAdminFinanceAction|request\.json|createAdminSupabaseClient/);
  assert.doesNotMatch(adminClient, /FinanceManager|applyFinanceMutationResponse|\/api\/admin\/finance/);
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

test("successful writes refresh finance without letting a failed read misreport the mutation", () => {
  assert.match(dispatch, /from "\.\/finance-admin-result"/);
  assert.equal((dispatch.match(/successfulFinanceMutation\(\(\) => getAdminFinanceOverview\(client\)/g) || []).length, 3);
  assert.match(result, /financeRefreshRequired: true/);
  assert.match(result, /ADMIN_FINANCE_POST_WRITE_REFRESH_FAILED/);
  assert.doesNotMatch(dispatch, /finance: await getAdminFinanceOverview\(client\)/);
  assert.match(dispatch, /recordManualClubInvoicePayment\(client, command\)/);
  assert.match(dispatch, /manageDancerEarning\(client, adminUserId, command\)/);
  assert.doesNotMatch(dispatch, /bitsafe|yoursafe|reconcileBitsafe/i);
});
