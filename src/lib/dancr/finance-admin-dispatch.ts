import type { SupabaseClient } from "@supabase/supabase-js";
import {
  manageDancerEarning,
  recordManualClubInvoicePayment,
  retryDancerPayout,
  updatePayoutSettings,
} from "./finance-admin-actions";
import {
  parseAdminFinanceCommand,
} from "./finance-admin-input";
import { successfulFinanceMutation } from "./finance-admin-result";
import { runQrFinanceAutomation } from "./finance-automation";
import { processDancerPayouts } from "./finance-payout-processing";
import { getAdminFinanceOverview } from "./finance-reporting";
import {
  disableNatsAffiliateLink,
  reconcileNatsCommissionExport,
  retryFailedNatsCommissionExport,
  verifyNatsAffiliateLink,
} from "./nats-affiliate-actions";
import { syncNatsCommissions } from "./nats-commission-sync";

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
    return successfulFinanceMutation(() => getAdminFinanceOverview(client), { result });
  }

  if (command.action === "process_payouts") {
    const result = await processDancerPayouts(client);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client), { result });
  }

  if (command.action === "verify_nats_affiliate") {
    await verifyNatsAffiliateLink(client, adminUserId, command.dancerId, command.reason);
    const result = await syncNatsCommissions(client);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client), { result });
  }

  if (command.action === "disable_nats_affiliate") {
    await disableNatsAffiliateLink(client, adminUserId, command.dancerId, command.reason);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client));
  }

  if (command.action === "retry_nats_export") {
    await retryFailedNatsCommissionExport(client, adminUserId, command.exportId, command.reason);
    const result = await syncNatsCommissions(client);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client), { result });
  }

  if (command.action === "reconcile_nats_export") {
    await reconcileNatsCommissionExport(client, adminUserId, command.exportId, command.resolution, command.reason);
    const result = command.resolution === "confirmed_not_exported" ? await syncNatsCommissions(client) : null;
    return successfulFinanceMutation(() => getAdminFinanceOverview(client), { result });
  }

  if (command.action === "record_manual_payment") {
    await recordManualClubInvoicePayment(client, command);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client));
  }

  if (command.action === "update_payout_settings") {
    await updatePayoutSettings(client, adminUserId, command);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client));
  }

  if (command.action === "manage_earning") {
    await manageDancerEarning(client, adminUserId, command);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client));
  }

  if (command.action === "retry_payout") {
    await retryDancerPayout(client, adminUserId, command);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client));
  }

  return unsupportedCommand(command);
}

function invalid(error: string): AdminFinanceDispatchResult {
  return { status: 400, body: { ok: false, error } };
}

function unsupportedCommand(command: never): AdminFinanceDispatchResult {
  void command;
  return invalid("Unsupported finance action.");
}
