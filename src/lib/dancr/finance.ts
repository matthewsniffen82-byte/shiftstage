import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMonthlyClubInvoiceDrafts,
  publishClubInvoiceDrafts,
  reconcileOpenClubInvoices,
  sendClubInvoiceReminders,
} from "./finance-invoices";
import { processDancerPayouts } from "./finance-payout-processing";

export {
  createMonthlyClubInvoiceDrafts,
  publishClubInvoiceDrafts,
  reconcileOpenClubInvoices,
  sendClubInvoiceReminders,
} from "./finance-invoices";
export { processDancerPayouts } from "./finance-payout-processing";
export {
  getAdminFinanceOverview,
  getDancerFinance,
  getVenueFinance,
} from "./finance-reporting";
export {
  dancerStatementCsv,
  getDancerStatementRows,
  getVenueStatementRows,
  venueStatementCsv,
} from "./finance-statements";

type DancrClient = SupabaseClient;
type FinanceRunResult = {
  invoicesCreated: number;
  invoicesOpened: number;
  invoicesReconciled: number;
  remindersSent: number;
  payoutsCreated: number;
  payoutsFailed: number;
  errors: string[];
};

export async function runQrFinanceAutomation(client: DancrClient): Promise<FinanceRunResult> {
  const result: FinanceRunResult = {
    invoicesCreated: 0,
    invoicesOpened: 0,
    invoicesReconciled: 0,
    remindersSent: 0,
    payoutsCreated: 0,
    payoutsFailed: 0,
    errors: [],
  };

  await captureFinanceStep(result, async () => {
    result.invoicesCreated = await createMonthlyClubInvoiceDrafts(client);
  });
  await captureFinanceStep(result, async () => {
    result.invoicesOpened = await publishClubInvoiceDrafts(client);
  });
  await captureFinanceStep(result, async () => {
    result.invoicesReconciled = await reconcileOpenClubInvoices(client);
  });
  await captureFinanceStep(result, async () => {
    result.remindersSent = await sendClubInvoiceReminders(client);
  });
  await captureFinanceStep(result, async () => {
    const payouts = await processDancerPayouts(client);
    result.payoutsCreated = payouts.created;
    result.payoutsFailed = payouts.failed;
    result.errors.push(...payouts.errors);
  });

  return result;
}

async function captureFinanceStep(result: FinanceRunResult, action: () => Promise<void>) {
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
