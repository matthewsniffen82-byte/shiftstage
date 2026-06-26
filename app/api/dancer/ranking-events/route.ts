import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerRankingEvents } from "@/src/lib/dancr/dancer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const events = await getDancerRankingEvents(client, user.id);

    return NextResponse.json({ ok: true, events });
  } catch (error) {
    return apiError(error, "Unable to load ranking events.");
  }
}
