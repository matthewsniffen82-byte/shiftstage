import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { getPublicEnv } from "@/src/lib/env";
import { createBoundedSupabaseFetch } from "@/src/lib/supabase/bounded-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    const env = getPublicEnv();
    const [{ error }, auth] = await Promise.all([admin
      .from("dancer_profiles")
      .select("id")
      .limit(1), createBoundedSupabaseFetch(undefined, 5_000)(`${env.supabaseUrl}/auth/v1/health`, {
        headers: { apikey: env.supabaseAnonKey },
      })]);

    if (error || !auth.ok) {
      console.error("SUPABASE_HEALTH_PROBE_FAILED", safeErrorMetadata(error));
      return unhealthySupabaseResponse();
    }

    return NextResponse.json({ ok: true, service: "supabase" }, { headers: { "cache-control": "private, no-store" } });
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
