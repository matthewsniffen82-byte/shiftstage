import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { deliverVenueCampaigns } from "@/src/lib/dancr/venue-campaign-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({ ok: true, ...await deliverVenueCampaigns(createAdminSupabaseClient()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.warn("VENUE_CAMPAIGN_WORKER_FAILED");
    return NextResponse.json({ ok: false, error: "Club updates need a retry." }, { status: 503 });
  }
}
