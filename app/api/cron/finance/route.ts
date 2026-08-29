import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { runQrFinanceAutomation } from "@/src/lib/dancr/finance-automation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runQrFinanceAutomation(createAdminSupabaseClient());
    console.info("QR finance automation completed", result);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("QR finance automation failed", error);
    return NextResponse.json({ ok: false, error: "QR finance automation failed." }, { status: 500 });
  }
}
