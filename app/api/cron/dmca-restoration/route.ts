import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import {
  forwardPendingDmcaCounterNotices,
  restoreEligibleDmcaCases,
} from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    const admin = createAdminSupabaseClient();
    const forwarded = await forwardPendingDmcaCounterNotices(admin);
    const results = await restoreEligibleDmcaCases(admin);
    return NextResponse.json({
      ok: true,
      counterNoticesForwarded: forwarded.filter((result) => result.forwarded).length,
      processed: results.length,
      restored: results.filter((result) => result.restored).length,
      forwarded,
      results,
    });
  } catch (error) {
    console.error("DMCA restoration worker failed", safeErrorMetadata(error));
    return NextResponse.json(
      { ok: false, error: "Copyright restoration worker failed." },
      { status: 500 },
    );
  }
}
