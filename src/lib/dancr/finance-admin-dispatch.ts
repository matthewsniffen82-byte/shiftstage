import type { SupabaseClient } from "@supabase/supabase-js";
import {
  manageDancerEarning,
  reconcileBitsafePayout,
  recordManualClubInvoicePayment,
  retryDancerPayout,
  updatePayoutSettings,
} from "./finance-admin-actions";
import {
  parseAdminFinanceCommand,
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
  const parsed = parseAdminFinanceCommand(input);
  if (!parsed.ok) return invalid(parsed.error);
  const command = parsed.value;

  if (command.action === "run_automation") {
    const result = await runQrFinanceAutomation(client);
    return success({ result, finance: await getAdminFinanceOverview(client) });
  }

  if (command.action === "process_payouts") {
    const result = await processDancerPayouts(client);
    return success({ result, finance: await getAdminFinanceOverview(client) });
  }

  if (command.action === "record_manual_payment") {
    await recordManualClubInvoicePayment(
      client,
      command.invoiceId,
      command.totalPaidCents,
      command.reference,
    );
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (command.action === "update_payout_settings") {
    await updatePayoutSettings(client, adminUserId, command);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (command.action === "manage_earning") {
    await manageDancerEarning(
      client,
      adminUserId,
      command.earningId,
      command.earningAction,
      command.reason,
    );
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (command.action === "retry_payout") {
    await retryDancerPayout(client, adminUserId, command.payoutId, command.reason);
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  if (command.action === "reconcile_bitsafe_payout") {
    await reconcileBitsafePayout(
      client,
      adminUserId,
      command.payoutId,
      command.reconciliationReference,
      command.reason,
    );
    return success({ finance: await getAdminFinanceOverview(client) });
  }

  return unsupportedCommand(command);
}

function success(body: Record<string, unknown>): AdminFinanceDispatchResult {
  return { status: 200, body: { ok: true, ...body } };
}

function invalid(error: string): AdminFinanceDispatchResult {
  return { status: 400, body: { ok: false, error } };
}

function unsupportedCommand(command: never): AdminFinanceDispatchResult {
  void command;
  return invalid("Unsupported finance action.");
}
