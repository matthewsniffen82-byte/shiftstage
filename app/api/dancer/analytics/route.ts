import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { dancerAnalyticsPeriod, getOwnDancerAudienceAnalytics } from "@/src/lib/dancr/dancer-audience-analytics";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const requestedPeriod = new URL(request.url).searchParams.get("period");
    if (requestedPeriod !== null && requestedPeriod !== "7d" && requestedPeriod !== "30d") {
      return NextResponse.json({ ok: false, error: "Choose a 7-day or 30-day analytics period." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient();
    const analytics = requestedPeriod === null
      ? await getOwnDancerDashboardAnalytics(client, user.id, admin)
      : await getOwnDancerAudienceAnalytics(admin, user.id, dancerAnalyticsPeriod(requestedPeriod));

    return NextResponse.json({ ok: true, analytics }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load dancer analytics.");
  }
}
