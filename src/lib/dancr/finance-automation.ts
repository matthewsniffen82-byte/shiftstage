import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMonthlyClubInvoiceDrafts,
  publishClubInvoiceDrafts,
  reconcileOpenClubInvoices,
  sendClubInvoiceReminders,
} from "./finance-invoices";
import { syncNatsAgentCommissions } from "./nats-commission-sync";
import { getNatsRuntimeConfig } from "./nats";

type DancrClient = SupabaseClient;

type ClubInvoiceAutomationResult = {
  invoicesCreated: number;
  invoicesOpened: number;
  invoicesReconciled: number;
  remindersSent: number;
  errors: string[];
};

type AgentCommissionAutomationResult = {
  payoutsCreated: number;
  payoutsFailed: number;
  natsExportsCreated: number;
  natsExportsFailed: number;
  natsReconciliationRequired: number;
  errors: string[];
};

export type FinanceRunResult = ClubInvoiceAutomationResult & AgentCommissionAutomationResult;

export async function runClubInvoiceAutomation(client: DancrClient): Promise<ClubInvoiceAutomationResult> {
  const result: ClubInvoiceAutomationResult = {
    invoicesCreated: 0,
    invoicesOpened: 0,
    invoicesReconciled: 0,
    remindersSent: 0,
    errors: [],
  };

  await captureFinanceStep(result, async () => {
    result.invoicesCreated = await createMonthlyClubInvoiceDrafts(client);
  });
  await captureFinanceStep(result, async () => {
    const publication = await publishClubInvoiceDrafts(client);
    result.invoicesOpened = publication.opened;
    result.errors.push(...publication.errors);
  });
  await captureFinanceStep(result, async () => {
    result.invoicesReconciled = await reconcileOpenClubInvoices(client);
  });
  await captureFinanceStep(result, async () => {
    result.remindersSent = await sendClubInvoiceReminders(client);
  });

  return result;
}

export async function runAgentCommissionAutomation(client: DancrClient): Promise<AgentCommissionAutomationResult> {
  const result: AgentCommissionAutomationResult = {
    payoutsCreated: 0,
    payoutsFailed: 0,
    natsExportsCreated: 0,
    natsExportsFailed: 0,
    natsReconciliationRequired: 0,
    errors: [],
  };

  await captureFinanceStep(result, async () => {
    if (getNatsRuntimeConfig().selected) {
      const agentExports = await syncNatsAgentCommissions(client);
      result.natsExportsCreated = agentExports.exported;
      result.natsExportsFailed = agentExports.failed;
      result.natsReconciliationRequired = agentExports.reconciliationRequired;
      result.errors.push(...agentExports.errors);
    }
  });

  return result;
}

export async function runQrFinanceAutomation(client: DancrClient): Promise<FinanceRunResult> {
  const invoices = await runClubInvoiceAutomation(client);
  const payouts = await runAgentCommissionAutomation(client);
  return {
    invoicesCreated: invoices.invoicesCreated,
    invoicesOpened: invoices.invoicesOpened,
    invoicesReconciled: invoices.invoicesReconciled,
    remindersSent: invoices.remindersSent,
    payoutsCreated: payouts.payoutsCreated,
    payoutsFailed: payouts.payoutsFailed,
    natsExportsCreated: payouts.natsExportsCreated,
    natsExportsFailed: payouts.natsExportsFailed,
    natsReconciliationRequired: payouts.natsReconciliationRequired,
    errors: [...invoices.errors, ...payouts.errors],
  };
}

async function captureFinanceStep(result: { errors: string[] }, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    result.errors.push(financeError(error));
  }
}

function financeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error) return String((error as any).message).slice(0, 500);
  return "Finance operation failed.";
}
