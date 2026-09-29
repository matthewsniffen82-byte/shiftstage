import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { deliverInternalRequestPush } from "@/src/lib/dancr/internal-request-push";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await deliverInternalRequestPush(createAdminSupabaseClient());
    return NextResponse.json({ ok: result.configured, ...result }, { status: result.configured ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch {
    console.warn("INTERNAL_REQUEST_PUSH_WORKER_FAILED");
    return NextResponse.json({ ok: false, error: "Table request notifications need a retry." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
