import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ManageEarningInput,
  ManualPaymentInput,
  PayoutSettingsInput,
  ReconcileBitsafePayoutInput,
  RetryPayoutInput,
} from "./finance-admin-input";
import {
  manageEarningRpcParameters,
  manualPaymentRpcParameters,
  payoutSettingsRpcParameters,
  retryPayoutRpcParameters,
} from "./finance-admin-rpc-params";
import { completeProviderPayout } from "./finance-provider-events";

type DancrClient = SupabaseClient;

export async function recordManualClubInvoicePayment(
  client: DancrClient,
  input: ManualPaymentInput,
) {
  const parameters = manualPaymentRpcParameters(input, new Date().toISOString());
  const { data, error } = await (client as any).rpc("apply_club_invoice_payment", parameters);
  if (error) throw error;
  return data;
}

export async function updatePayoutSettings(
  client: DancrClient,
  adminUserId: string,
  input: PayoutSettingsInput,
) {
  const parameters = payoutSettingsRpcParameters(adminUserId, input);
  const { data, error } = await (client as any).rpc("admin_update_payout_settings", parameters);
  if (error) throw error;
  return data;
}

export async function manageDancerEarning(
  client: DancrClient,
  adminUserId: string,
  input: ManageEarningInput,
) {
  const parameters = manageEarningRpcParameters(adminUserId, input);
  const { data, error } = await (client as any).rpc("admin_manage_dancer_earning", parameters);
  if (error) throw error;
  return data;
}

export async function retryDancerPayout(
  client: DancrClient,
  adminUserId: string,
  input: RetryPayoutInput,
) {
  const parameters = retryPayoutRpcParameters(adminUserId, input);
  const { data, error } = await (client as any).rpc("admin_retry_dancer_payout", parameters);
  if (error) throw error;
  return data;
}

export async function reconcileBitsafePayout(
  client: DancrClient,
  adminUserId: string,
  input: ReconcileBitsafePayoutInput,
  paidAt = new Date().toISOString(),
) {
  const { data: payout, error } = await (client as any).from("dancer_payout_batches")
    .select("id, status, payment_provider, provider_reference_id")
    .eq("id", input.payoutId)
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
    reason: input.reason,
    metadata: {
      payment_provider: "bitsafe",
      provider_reference_id: providerReferenceId,
      reconciliation_reference: input.reconciliationReference,
      paid_at: paidAt,
      source: "verified_yoursafe_payout_report",
    },
  });
  if (auditError) throw auditError;
  return reconciled;
}
