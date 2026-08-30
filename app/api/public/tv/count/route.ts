import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getPublicMyDancrTvVideoCount } from "@/src/lib/dancr/tv";
import { PUBLIC_DYNAMIC_CACHE_CONTROL } from "@/src/lib/dancr/public-cache-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedCity = (url.searchParams.get("city") || "").trim().slice(0, 80);
    const city = requestedCity || "Las Vegas";
    const venueId = cleanUuid(url.searchParams.get("venue"));
    const approvedVideoCount = await getPublicMyDancrTvVideoCount(
      createAdminSupabaseClient(),
      { city, venueId },
    );

    return NextResponse.json(
      { ok: true, city, approvedVideoCount },
      { headers: { "Cache-Control": PUBLIC_DYNAMIC_CACHE_CONTROL } },
    );
  } catch (error) {
    return apiError(error, "Unable to load the MyDancr TV video count.");
  }
}

function cleanUuid(value: string | null) {
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
