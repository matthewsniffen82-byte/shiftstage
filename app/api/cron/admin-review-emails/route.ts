import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { deliverAdminReviewEmails } from "@/src/lib/dancr/admin-review-email-delivery";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { runWithServerJob } from "@/src/lib/server-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const result = await runWithServerJob(async () => {
      const client = createAdminSupabaseClient();
      const alerts = await client.rpc("enqueue_case_alerts");
      if (alerts.error) throw alerts.error;
      return deliverAdminReviewEmails(client);
    }, 52_000);
    return NextResponse.json({ ok: result.configured && result.failed === 0, ...result }, {
      status: result.configured && result.failed === 0 ? 200 : 503, headers: { "cache-control": "no-store" },
    });
  } catch {
    console.warn("ADMIN_REVIEW_EMAIL_WORKER_FAILED");
    return NextResponse.json({ ok: false, error: "Admin email alerts need a retry." }, { status: 503 });
  }
}
