import type { SupabaseClient } from "@supabase/supabase-js";
import {
  manageDancerEarning,
  recordManualClubInvoicePayment,
} from "./finance-admin-actions";
import {
  parseAdminFinanceCommand,
} from "./finance-admin-input";
import { successfulFinanceMutation } from "./finance-admin-result";
import { runQrFinanceAutomation } from "./finance-automation";
import { getAdminFinanceOverview } from "./finance-reporting";
type DancrClient = SupabaseClient;

export type AdminFinanceDispatchResult = {
  status: 200 | 400 | 410;
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

  if (command.action === "process_payouts" || command.action === "update_payout_settings"
    || command.action === "retry_payout" || command.action === "verify_nats_affiliate"
    || command.action === "disable_nats_affiliate" || command.action === "retry_nats_export"
    || command.action === "reconcile_nats_export") {
    return { status: 410, body: { ok: false, error: "The dancer commission program has ended." } };
  }

  if (command.action === "record_manual_payment") {
    await recordManualClubInvoicePayment(client, command);
    return successfulFinanceMutation(() => getAdminFinanceOverview(client));
  }

  if (command.action === "manage_earning") {
    await manageDancerEarning(client, adminUserId, command);
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
