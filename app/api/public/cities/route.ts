import { NextResponse } from "next/server";
import { getDancerDiscoveryCities } from "@/src/lib/dancr/signup-cities";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cities = await getDancerDiscoveryCities(createAdminSupabaseClient());
    return NextResponse.json(
      { ok: true, cities },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("DANCER_SIGNUP_CITIES_LOAD_FAILED", {
      ...safeErrorMetadata(error),
    });
    return NextResponse.json(
      { ok: false, error: "Unable to load available cities." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
