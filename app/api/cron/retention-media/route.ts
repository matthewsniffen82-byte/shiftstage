import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { drainRetentionMedia } from "@/src/lib/dancr/lifecycle-retention";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { runWithServerJob } from "@/src/lib/server-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const media = await runWithServerJob(() => drainRetentionMedia(createAdminSupabaseClient()), 54_000);
    const ok = media.failed === 0 && media.oldestDueMinutes < 15;
    if (!ok) console.warn("RETENTION_MEDIA_QUEUE_NEEDS_ATTENTION", media);
    return NextResponse.json({ ok, ...media }, { status: ok ? 200 : 503 });
  } catch {
    console.warn("RETENTION_MEDIA_WORKER_FAILED");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
