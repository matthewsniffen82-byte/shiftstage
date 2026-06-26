import { NextResponse } from "next/server";
import { getApprovedDancersByCity, getTonightShifts } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = url.searchParams.get("city") || "Las Vegas";
    const scope = url.searchParams.get("scope") || "all";
    const client = createAdminSupabaseClient();
    const dancers =
      scope === "tonight" ? await getTonightShifts(client, city) : await getApprovedDancersByCity(client, city);

    return NextResponse.json({ ok: true, city, scope, dancers });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load dancers." },
      { status: 500 },
    );
  }
}
