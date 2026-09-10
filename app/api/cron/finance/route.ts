import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { runQrFinanceAutomation } from "@/src/lib/dancr/finance-automation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runQrFinanceAutomation(createAdminSupabaseClient());
    const counts = {
      invoicesCreated: result.invoicesCreated,
      invoicesOpened: result.invoicesOpened,
      invoicesReconciled: result.invoicesReconciled,
      remindersSent: result.remindersSent,
      payoutsCreated: result.payoutsCreated,
      payoutsFailed: result.payoutsFailed,
      natsExportsCreated: result.natsExportsCreated,
      natsExportsFailed: result.natsExportsFailed,
      natsReconciliationRequired: result.natsReconciliationRequired,
    };
    if (!Array.isArray(result.errors) || Object.values(counts).some(count => !Number.isSafeInteger(count) || count < 0)) {
      throw new Error("Finance job result could not be confirmed.");
    }
    const errorCount = result.errors.length;
    const partial = errorCount > 0 || counts.payoutsFailed > 0 || counts.natsExportsFailed > 0 || counts.natsReconciliationRequired > 0;
    const message = "Some finance work needs review. Check current invoice and payout states before retrying.";
    const responseResult = { ...counts, errors: result.errors.map(() => message) };
    if (partial) {
      console.error("QR finance automation partially completed", { ...counts, errorCount });
      return NextResponse.json({ ok: false, partial: true, error: message, result: responseResult }, { status: 500 });
    }
    console.info("QR finance automation completed", { ...counts, errorCount });
    return NextResponse.json({ ok: true, result: responseResult });
  } catch (error) {
    console.error("QR finance automation failed", safeErrorMetadata(error));
    return NextResponse.json({ ok: false, error: "QR finance automation failed." }, { status: 500 });
  }
}
