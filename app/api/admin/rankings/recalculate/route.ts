import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { recalculateCityRankings, requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await request.json();
    const city = typeof body?.city === "string" && body.city.trim() ? body.city.trim() : "Las Vegas";
    const rankings = await recalculateCityRankings(createAdminSupabaseClient(), user.id, city);

    return NextResponse.json({ ok: true, city, rankings });
  } catch (error) {
    return apiError(error, "Unable to recalculate rankings.");
  }
}
