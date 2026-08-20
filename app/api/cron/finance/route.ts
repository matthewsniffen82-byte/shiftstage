import { NextResponse } from "next/server";
import { runQrFinanceAutomation } from "@/src/lib/dancr/finance-automation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runQrFinanceAutomation(createAdminSupabaseClient());
    console.info("QR finance automation completed", result);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("QR finance automation failed", error);
    return NextResponse.json({ ok: false, error: "QR finance automation failed." }, { status: 500 });
  }
}
