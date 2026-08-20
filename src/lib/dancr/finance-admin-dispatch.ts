import type { SupabaseClient } from "@supabase/supabase-js";
import {
  manageDancerEarning,
  reconcileBitsafePayout,
  recordManualClubInvoicePayment,
  retryDancerPayout,
  updatePayoutSettings,
} from "./finance-admin-actions";
import {
  parseManageEarningInput,
  parseManualPaymentInput,
  parsePayoutSettingsInput,
  parseReconcileBitsafePayoutInput,
  parseRetryPayoutInput,
} from "./finance-admin-input";
import { runQrFinanceAutomation } from "./finance-automation";
import { processDancerPayouts } from "./finance-payout-processing";
import { getAdminFinanceOverview } from "./finance-reporting";

type DancrClient = SupabaseClient;

export type AdminFinanceDispatchResult = {
  status: 200 | 400;
  body: Record<string, unknown>;
};

export async function dispatchAdminFinanceAction(
  client: DancrClient,
  adminUserId: string,
  input: unknown,
): Promise<AdminFinanceDispatchResult> {
  const body = input as Record<string, unknown>;

  if (body.action === "run_automation") {
    const result = await runQrFinanceAutomation(client);
    return success({ result, finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "process_payouts") {
    const result = await processDancerPayouts(client);
    return success({ result, finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "record_manual_payment") {
    const parsed = parseManualPaymentInput(body);
    if (!parsed.ok) return invalid(parsed.error);
    await recordManualClubInvoicePayment(
      client,
      parsed.value.invoiceId,
      parsed.value.totalPaidCents,
      parsed.value.reference,
    );
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "update_payout_settings") {
    const parsed = parsePayoutSettingsInput(body);
    if (!parsed.ok) return invalid(parsed.error);
    await updatePayoutSettings(client, adminUserId, parsed.value);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "manage_earning") {
    const parsed = parseManageEarningInput(body);
    if (!parsed.ok) return invalid(parsed.error);
    await manageDancerEarning(
      client,
      adminUserId,
      parsed.value.earningId,
      parsed.value.earningAction,
      parsed.value.reason,
    );
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "retry_payout") {
    const parsed = parseRetryPayoutInput(body);
    if (!parsed.ok) return invalid(parsed.error);
    await retryDancerPayout(client, adminUserId, parsed.value.payoutId, parsed.value.reason);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "reconcile_bitsafe_payout") {
    const parsed = parseReconcileBitsafePayoutInput(body);
    if (!parsed.ok) return invalid(parsed.error);
    await reconcileBitsafePayout(
      client,
      adminUserId,
      parsed.value.payoutId,
      parsed.value.reconciliationReference,
      parsed.value.reason,
    );
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  return invalid("Unsupported finance action.");
}

function success(body: Record<string, unknown>): AdminFinanceDispatchResult {
  return { status: 200, body: { ok: true, ...body } };
}

function invalid(error: string): AdminFinanceDispatchResult {
  return { status: 400, body: { ok: false, error } };
}
