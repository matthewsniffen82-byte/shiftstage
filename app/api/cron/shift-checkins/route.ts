import { NextResponse } from "next/server";
import { reconcileExpiredDancerShifts } from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

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
    console.error("Expired dancer shift reconciliation failed", error);
    return NextResponse.json({ ok: false, error: "Shift reconciliation failed." }, { status: 500 });
  }
}

function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
