import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { reconcileExpiredDancerShifts } from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    const ended = await reconcileExpiredDancerShifts(createAdminSupabaseClient(), undefined, 100);
    console.info("Expired dancer shift reconciliation completed", { ended: ended.length });
    return NextResponse.json({ ok: true, ended: ended.length });
  } catch (error) {
    console.error("Expired dancer shift reconciliation failed", safeErrorMetadata(error));
    return NextResponse.json({ ok: false, error: "Shift reconciliation failed." }, { status: 500 });
  }
}
