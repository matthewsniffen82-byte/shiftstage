import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    const { error } = await admin
      .from("dancer_profiles")
      .select("id")
      .limit(1);

    if (error) {
      console.error("SUPABASE_HEALTH_PROBE_FAILED", safeErrorMetadata(error));
      return unhealthySupabaseResponse();
    }

    return NextResponse.json({ ok: true, service: "supabase" });
  } catch (error) {
    console.error("SUPABASE_HEALTH_PROBE_FAILED", safeErrorMetadata(error));
    return unhealthySupabaseResponse();
  }
}

function unhealthySupabaseResponse() {
  return NextResponse.json(
    { ok: false, service: "supabase", error: "Supabase health check failed." },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
}
