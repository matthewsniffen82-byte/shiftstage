import { NextResponse } from "next/server";
import {
  forwardPendingDmcaCounterNotices,
  restoreEligibleDmcaCases,
} from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

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
    console.error("DMCA restoration worker failed", error);
    return NextResponse.json(
      { ok: false, error: "Copyright restoration worker failed." },
      { status: 500 },
    );
  }
}

function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
