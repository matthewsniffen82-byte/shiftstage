import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { runWithServerJob } from "@/src/lib/server-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const failed = await runWithServerJob(async () => {
      const db = createAdminSupabaseClient();
      const claim = await db.rpc("claim_venue_email_preparation");
      if (claim.error || !Array.isArray(claim.data)) throw new Error("Club preparation claim failed.");
      const results = await Promise.allSettled(claim.data.map(async job => {
        const result = await db.rpc("prepare_club_email_alerts", { p_venue: job.venue_id, p_lease: job.lease_id });
        if (result.error || result.data !== true) throw new Error("Club preparation deferred.");
      }));
      return results.filter(result => result.status === "rejected").length;
    }, 50_000);
    return NextResponse.json({ ok: failed === 0, failed }, { status: failed ? 503 : 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
