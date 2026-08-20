import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ManageEarningInput,
  ManualPaymentInput,
  PayoutSettingsInput,
  RetryPayoutInput,
} from "./finance-admin-input";
import {
  manageEarningRpcParameters,
  manualPaymentRpcParameters,
  payoutSettingsRpcParameters,
  retryPayoutRpcParameters,
} from "./finance-admin-rpc-params";

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
