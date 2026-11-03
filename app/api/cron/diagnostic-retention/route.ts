import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
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
    const [{ data, error }, pruned] = await Promise.all([
      admin.rpc("run_diagnostic_retention"), admin.rpc("prune_discovery_history"),
    ]);
    if (error) throw error;
    if (pruned.error) throw pruned.error;
    const failed = !data || data.status === "failed";
    return NextResponse.json({ ok: !failed, receipt: data }, {
      status: failed ? 503 : 200, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "diagnostic_retention.failed", ...safeErrorMetadata(error) }));
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
