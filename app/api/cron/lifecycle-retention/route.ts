import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { exportDeletionRecovery, processRetentionMedia, retryClosedAccountDeletion } from "@/src/lib/dancr/lifecycle-retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const db = createAdminSupabaseClient();
    const run = await db.rpc("run_lifecycle_retention");
    if (run.error || !run.data) throw new Error("Retention worker unavailable");
    // Save the database sweep before provider work; preserve another export even if it fails.
    let recovery = await exportDeletionRecovery(db);
    let accounts, media;
    try {
      accounts = await retryClosedAccountDeletion(db);
      media = await processRetentionMedia(db);
    } finally {
      recovery = await exportDeletionRecovery(db);
    }
    const ok = run.data.status !== "failed" && media.failed === 0 && accounts.failed === 0;
    return NextResponse.json({ ok, receipt: run.data, accounts, media, recovery }, { status: ok ? 200 : 503, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // No subject identifiers, paths, tokens or provider exception payloads in logs.
    console.error(JSON.stringify({ event: "lifecycle_retention.failed" }));
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
