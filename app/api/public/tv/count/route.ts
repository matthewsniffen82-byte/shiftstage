import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getPublicMyDancrTvVideoCount } from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedCity = (url.searchParams.get("city") || "").trim().slice(0, 80);
    const city = requestedCity || "Las Vegas";
    const approvedVideoCount = await getPublicMyDancrTvVideoCount(
      createAdminSupabaseClient(),
      { city },
    );

    return NextResponse.json(
      { ok: true, city, approvedVideoCount },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, "Unable to load the MyDancr TV video count.");
  }
}
