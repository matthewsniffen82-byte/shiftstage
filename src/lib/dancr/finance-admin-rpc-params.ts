import type {
  ManageEarningInput,
  ManualPaymentInput,
  PayoutSettingsInput,
  RetryPayoutInput,
} from "./finance-admin-input";

export function manualPaymentRpcParameters(input: ManualPaymentInput, paidAt: string) {
  return {
    p_invoice_id: input.invoiceId,
    p_total_paid_cents: input.totalPaidCents,
    p_payment_reference: input.reference,
    p_paid_at: paidAt,
    p_stripe_invoice_id: null,
    p_hosted_invoice_url: null,
    p_invoice_pdf_url: null,
  };
}

export function payoutSettingsRpcParameters(adminUserId: string, input: PayoutSettingsInput) {
  return {
    p_admin_user_id: adminUserId,
    p_payouts_enabled: input.payoutsEnabled,
    p_payment_provider: input.paymentProvider,
    p_earnings_hold_days: input.earningsHoldDays,
    p_minimum_payout_cents: input.minimumPayoutCents,
    p_payout_mode: input.payoutMode,
  };
}

export function manageEarningRpcParameters(adminUserId: string, input: ManageEarningInput) {
  return {
    p_admin_user_id: adminUserId,
    p_earning_id: input.earningId,
    p_action: input.earningAction,
    p_reason: input.reason,
  };
}

export function retryPayoutRpcParameters(adminUserId: string, input: RetryPayoutInput) {
  return {
    p_admin_user_id: adminUserId,
    p_failed_payout_id: input.payoutId,
    p_reason: input.reason,
  };
}
