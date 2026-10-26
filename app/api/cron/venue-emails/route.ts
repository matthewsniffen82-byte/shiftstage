import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { deliverVenueEmails } from "@/src/lib/dancr/venue-email-delivery";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { runWithServerJob } from "@/src/lib/server-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await runWithServerJob(() => deliverVenueEmails(createAdminSupabaseClient()), 52_000);
    return NextResponse.json({ ok: result.configured && result.failed === 0, ...result },
      { status: result.configured && result.failed === 0 ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch {
    console.warn("VENUE_EMAIL_WORKER_FAILED");
    return NextResponse.json({ ok: false, error: "Club email alerts need a retry." }, { status: 503 });
  }
}
