import assert from "node:assert/strict";
import test from "node:test";
import {
  manageEarningRpcParameters,
  manualPaymentRpcParameters,
  payoutSettingsRpcParameters,
  retryPayoutRpcParameters,
} from "../src/lib/dancr/finance-admin-rpc-params.ts";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const INVOICE_ID = "00000000-0000-4000-8000-000000000002";
const EARNING_ID = "00000000-0000-4000-8000-000000000003";
const PAYOUT_ID = "00000000-0000-4000-8000-000000000004";

test("validated admin finance values map to exact database parameters without further coercion", () => {
  assert.deepEqual(manualPaymentRpcParameters({
    invoiceId: INVOICE_ID,
    reference: "bank-reference",
    totalPaidCents: 1250,
  }, "2026-08-20T18:00:00.000Z"), {
    p_invoice_id: INVOICE_ID,
    p_total_paid_cents: 1250,
    p_payment_reference: "bank-reference",
    p_paid_at: "2026-08-20T18:00:00.000Z",
    p_stripe_invoice_id: null,
    p_hosted_invoice_url: null,
    p_invoice_pdf_url: null,
  });

  assert.deepEqual(payoutSettingsRpcParameters(ADMIN_ID, {
    payoutsEnabled: false,
    paymentProvider: "adyen",
    payoutMode: "scheduled",
    earningsHoldDays: 14,
    minimumPayoutCents: 5000,
  }), {
    p_admin_user_id: ADMIN_ID,
    p_payouts_enabled: false,
    p_payment_provider: "adyen",
    p_earnings_hold_days: 14,
    p_minimum_payout_cents: 5000,
    p_payout_mode: "scheduled",
  });

  assert.deepEqual(manageEarningRpcParameters(ADMIN_ID, {
    earningId: EARNING_ID,
    earningAction: "hold",
    reason: "fraud review",
  }), {
    p_admin_user_id: ADMIN_ID,
    p_earning_id: EARNING_ID,
    p_action: "hold",
    p_reason: "fraud review",
  });

  assert.deepEqual(retryPayoutRpcParameters(ADMIN_ID, {
    payoutId: PAYOUT_ID,
    reason: "provider retry approved",
  }), {
    p_admin_user_id: ADMIN_ID,
    p_failed_payout_id: PAYOUT_ID,
    p_reason: "provider retry approved",
  });
});
