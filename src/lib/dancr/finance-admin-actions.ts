import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayoutMode, PayoutProviderName } from "./payout-provider";
import { completeProviderPayout } from "./finance-provider-events";

type DancrClient = SupabaseClient;

export async function recordManualClubInvoicePayment(
  client: DancrClient,
  invoiceId: string,
  totalPaidCents: number,
  reference: string,
) {
  const { data, error } = await (client as any).rpc("apply_club_invoice_payment", {
    p_invoice_id: invoiceId,
    p_total_paid_cents: Math.max(0, Math.trunc(totalPaidCents)),
    p_payment_reference: reference.trim(),
    p_paid_at: new Date().toISOString(),
    p_stripe_invoice_id: null,
    p_hosted_invoice_url: null,
    p_invoice_pdf_url: null,
  });
  if (error) throw error;
  return data;
}

export async function updatePayoutSettings(
  client: DancrClient,
  adminUserId: string,
  input: {
    payoutsEnabled: boolean;
    paymentProvider: PayoutProviderName;
    earningsHoldDays: number;
    minimumPayoutCents: number;
    payoutMode: PayoutMode;
  },
) {
  const { data, error } = await (client as any).rpc("admin_update_payout_settings", {
    p_admin_user_id: adminUserId,
    p_payouts_enabled: Boolean(input.payoutsEnabled),
    p_payment_provider: input.paymentProvider,
    p_earnings_hold_days: input.earningsHoldDays,
    p_minimum_payout_cents: input.minimumPayoutCents,
    p_payout_mode: input.payoutMode,
  });
  if (error) throw error;
  return data;
}

export async function manageDancerEarning(
  client: DancrClient,
  adminUserId: string,
  earningId: string,
  action: string,
  reason: string,
) {
  const { data, error } = await (client as any).rpc("admin_manage_dancer_earning", {
    p_admin_user_id: adminUserId,
    p_earning_id: earningId,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function retryDancerPayout(
  client: DancrClient,
  adminUserId: string,
  payoutId: string,
  reason: string,
) {
  const { data, error } = await (client as any).rpc("admin_retry_dancer_payout", {
    p_admin_user_id: adminUserId,
    p_failed_payout_id: payoutId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function reconcileBitsafePayout(
  client: DancrClient,
  adminUserId: string,
  payoutId: string,
  reconciliationReference: string,
  reason: string,
  paidAt = new Date().toISOString(),
) {
  const { data: payout, error } = await (client as any).from("dancer_payout_batches")
    .select("id, status, payment_provider, provider_reference_id")
    .eq("id", payoutId)
    .maybeSingle();
  if (error) throw error;
  if (!payout || payout.payment_provider !== "bitsafe" || payout.status !== "processing") {
    throw new Error("Only a processing Bitsafe payout can be reconciled.");
  }
  const providerReferenceId = String(payout.provider_reference_id || "");
  if (!providerReferenceId.startsWith("bitsafe:")) throw new Error("Bitsafe payout reference is missing.");
  const reconciled = await completeProviderPayout(client, providerReferenceId, paidAt, payout.id);
  if (!reconciled) throw new Error("Bitsafe payout could not be reconciled.");
  const { error: auditError } = await (client as any).from("financial_audit_events").insert({
    actor_user_id: adminUserId,
    actor_type: "admin",
    action: "bitsafe_payout_reconciled",
    target_type: "payout",
    target_id: payout.id,
    reason: reason.slice(0, 500),
    metadata: {
      payment_provider: "bitsafe",
      provider_reference_id: providerReferenceId,
      reconciliation_reference: reconciliationReference.slice(0, 160),
      paid_at: paidAt,
      source: "verified_yoursafe_payout_report",
    },
  });
  if (auditError) throw auditError;
  return reconciled;
}
