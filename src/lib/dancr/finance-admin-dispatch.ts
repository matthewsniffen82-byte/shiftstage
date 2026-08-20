import type { SupabaseClient } from "@supabase/supabase-js";
import {
  manageDancerEarning,
  reconcileBitsafePayout,
  recordManualClubInvoicePayment,
  retryDancerPayout,
  updatePayoutSettings,
} from "./finance-admin-actions";
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
    const invoiceId = requiredText(body.invoiceId, "Invoice is required.");
    const reference = requiredText(body.reference, "Payment reference is required.");
    const totalPaidCents = Number(body.totalPaidCents);
    if (!Number.isInteger(totalPaidCents) || totalPaidCents <= 0) {
      return invalid("Payment total must be a positive whole number of cents.");
    }
    await recordManualClubInvoicePayment(client, invoiceId, totalPaidCents, reference);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "update_payout_settings") {
    const paymentProvider = oneOf(body.paymentProvider, ["stripe", "bitsafe", "adyen", "other"] as const, "Unsupported payout provider.");
    const payoutMode = oneOf(body.payoutMode, ["manual_cashout", "scheduled", "both"] as const, "Unsupported payout mode.");
    const earningsHoldDays = boundedInteger(body.earningsHoldDays, 0, 90, "Hold days must be between 0 and 90.");
    const minimumPayoutCents = boundedInteger(body.minimumPayoutCents, 1, 10_000_000, "Minimum payout is invalid.");
    await updatePayoutSettings(client, adminUserId, {
      payoutsEnabled: body.payoutsEnabled === true,
      paymentProvider,
      payoutMode,
      earningsHoldDays,
      minimumPayoutCents,
    });
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "manage_earning") {
    const earningId = requiredText(body.earningId, "Earning is required.");
    const earningAction = oneOf(body.earningAction, ["hold", "release", "reverse"] as const, "Unsupported earning action.");
    const reason = requiredText(body.reason, "A financial audit reason is required.");
    if (reason.length < 3 || reason.length > 500) {
      return invalid("Reason must be between 3 and 500 characters.");
    }
    await manageDancerEarning(client, adminUserId, earningId, earningAction, reason);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "retry_payout") {
    const payoutId = requiredText(body.payoutId, "Payout is required.");
    const reason = requiredText(body.reason, "A retry reason is required.");
    if (reason.length < 3 || reason.length > 500) {
      return invalid("Reason must be between 3 and 500 characters.");
    }
    await retryDancerPayout(client, adminUserId, payoutId, reason);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (body.action === "reconcile_bitsafe_payout") {
    const payoutId = requiredText(body.payoutId, "Payout is required.");
    const reconciliationReference = requiredText(body.reconciliationReference, "Yoursafe report reference is required.");
    const reason = requiredText(body.reason, "A reconciliation reason is required.");
    if (reconciliationReference.length > 160 || reason.length < 3 || reason.length > 500) {
      return invalid("Reconciliation details are invalid.");
    }
    await reconcileBitsafePayout(client, adminUserId, payoutId, reconciliationReference, reason);
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

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function boundedInteger(value: unknown, minimum: number, maximum: number, message: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(message);
  return parsed;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, message: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(message);
  return value as T[number];
}
