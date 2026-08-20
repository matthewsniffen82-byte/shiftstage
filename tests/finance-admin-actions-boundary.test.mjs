import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [actions, dispatch, finance, parameters, route] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-admin-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-rpc-params.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/finance/route.ts", import.meta.url), "utf8"),
]);

test("manual admin finance writes use one dedicated action boundary", () => {
  assert.match(dispatch, /from "\.\/finance-admin-actions"/);
  assert.match(dispatch, /from "\.\/finance-admin-input"/);
  assert.match(route, /from "@\/src\/lib\/dancr\/finance-admin-dispatch"/);
  assert.match(route, /await requireAdmin\(client, user\.id\)/);
  assert.match(dispatch, /from "\.\/finance-automation"/);
  assert.match(dispatch, /from "\.\/finance-reporting"/);
  for (const action of [
    "recordManualClubInvoicePayment",
    "updatePayoutSettings",
    "manageDancerEarning",
    "retryDancerPayout",
    "reconcileBitsafePayout",
  ]) {
    assert.match(actions, new RegExp(`export async function ${action}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${action}`));
  }
});

test("invoice, setting, earning, and retry actions preserve the exact database procedures", () => {
  assert.match(actions, /rpc\("apply_club_invoice_payment"/);
  assert.match(actions, /manualPaymentRpcParameters\(input, new Date\(\)\.toISOString\(\)\)/);
  assert.match(parameters, /p_total_paid_cents: input\.totalPaidCents/);
  assert.doesNotMatch(`${actions}\n${parameters}`, /Math\.max\(0, Math\.trunc/);
  assert.match(actions, /rpc\("admin_update_payout_settings"/);
  assert.match(parameters, /p_payouts_enabled: input\.payoutsEnabled/);
  assert.doesNotMatch(`${actions}\n${parameters}`, /Boolean\(input\.payoutsEnabled\)/);
  assert.match(actions, /rpc\("admin_manage_dancer_earning"/);
  assert.match(parameters, /p_reason: input\.reason/);
  assert.match(actions, /rpc\("admin_retry_dancer_payout"/);
  assert.match(parameters, /p_failed_payout_id: input\.payoutId/);
  for (const inputType of [
    "ManualPaymentInput",
    "PayoutSettingsInput",
    "ManageEarningInput",
    "RetryPayoutInput",
    "ReconcileBitsafePayoutInput",
  ]) {
    assert.match(actions, new RegExp(`input: ${inputType}`));
  }
});

test("Bitsafe reconciliation remains guarded, provider-completed, and audited", () => {
  assert.match(actions, /payout\.payment_provider !== "bitsafe" \|\| payout\.status !== "processing"/);
  assert.match(actions, /providerReferenceId\.startsWith\("bitsafe:"\)/);
  assert.match(actions, /completeProviderPayout\(client, providerReferenceId, paidAt, payout\.id\)/);
  assert.match(actions, /action: "bitsafe_payout_reconciled"/);
  assert.match(actions, /reason: input\.reason/);
  assert.match(actions, /reconciliation_reference: input\.reconciliationReference/);
  assert.doesNotMatch(actions, /reason\.slice|reconciliationReference\.slice/);
  assert.match(actions, /source: "verified_yoursafe_payout_report"/);
});
