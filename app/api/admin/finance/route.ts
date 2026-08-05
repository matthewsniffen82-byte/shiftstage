import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminFinanceOverview,
  processDancerPayouts,
  recordManualClubInvoicePayment,
  runQrFinanceAutomation,
} from "@/src/lib/dancr/finance";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const finance = await getAdminFinanceOverview(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, finance });
  } catch (error) {
    return apiError(error, "Unable to load QR finance operations.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();

    if (body.action === "run_automation") {
      const result = await runQrFinanceAutomation(admin);
      return NextResponse.json({ ok: true, result, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "process_payouts") {
      const result = await processDancerPayouts(admin);
      return NextResponse.json({ ok: true, result, finance: await getAdminFinanceOverview(admin) });
    }

    if (body.action === "record_manual_payment") {
      const invoiceId = requiredText(body.invoiceId, "Invoice is required.");
      const reference = requiredText(body.reference, "Payment reference is required.");
      const totalPaidCents = Number(body.totalPaidCents);
      if (!Number.isInteger(totalPaidCents) || totalPaidCents <= 0) {
        return NextResponse.json({ ok: false, error: "Payment total must be a positive whole number of cents." }, { status: 400 });
      }
      await recordManualClubInvoicePayment(admin, invoiceId, totalPaidCents, reference);
      return NextResponse.json({ ok: true, finance: await getAdminFinanceOverview(admin) });
    }

    return NextResponse.json({ ok: false, error: "Unsupported finance action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to update QR finance operations.");
  }
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}
