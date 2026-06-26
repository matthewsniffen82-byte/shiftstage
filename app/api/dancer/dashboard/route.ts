import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const analytics = await getOwnDancerDashboardAnalytics(client, user.id);

    return NextResponse.json({ ok: true, analytics });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
