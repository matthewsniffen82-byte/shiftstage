import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerDealMetrics } from "@/src/lib/dancr/deals";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const [analytics, deals] = await Promise.all([
      getOwnDancerDashboardAnalytics(client, user.id),
      getDancerDealMetrics(client, user.id),
    ]);

    return NextResponse.json({ ok: true, analytics, deals });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
