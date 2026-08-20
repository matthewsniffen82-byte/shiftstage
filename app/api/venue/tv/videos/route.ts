import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueMyDancrTvVideos } from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const dashboard = await getVenueMyDancrTvVideos(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (error) {
    return apiError(error, "Unable to load venue MyDancr TV videos.");
  }
}
