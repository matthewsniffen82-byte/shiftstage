import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

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
      console.error("SUPABASE_HEALTH_PROBE_FAILED", formatSupabaseError(error));
      return unhealthySupabaseResponse();
    }

    return NextResponse.json({ ok: true, service: "supabase" });
  } catch (error) {
    console.error("SUPABASE_HEALTH_PROBE_FAILED", formatUnexpectedError(error));
    return unhealthySupabaseResponse();
  }
}

function unhealthySupabaseResponse() {
  return NextResponse.json(
    { ok: false, service: "supabase", error: "Supabase health check failed." },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
}

function formatSupabaseError(error: { code?: unknown } | null | undefined) {
  return {
    message: "Supabase REST health probe failed.",
    code: String(error?.code || "unknown"),
  };
}

function formatUnexpectedError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unknown error.",
      name: error.name,
    };
  }

  return {
    message: String(error || "Unknown health check error."),
  };
}
