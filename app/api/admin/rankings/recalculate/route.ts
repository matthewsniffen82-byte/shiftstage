import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { recalculateCityRankings, requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_RANKING_RECALCULATION_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_RANKING_RECALCULATION_BODY_BYTES,
      invalidMessage: "Invalid ranking recalculation request.",
      tooLargeMessage: "Ranking recalculation request is too large.",
    });
    const city = typeof body?.city === "string" && body.city.trim() ? body.city.trim() : "Las Vegas";
    const rankings = await recalculateCityRankings(createAdminSupabaseClient(), user.id, city);

    return NextResponse.json({ ok: true, city, rankings, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to recalculate rankings.");
  }
}
