import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueAnalytics, getVenueDashboard, getVenueDashboardOperations, getVenueDashboardSummary, readVenueAnalyticsPeriod } from "@/src/lib/dancr/venue";
import { requireVenueAccess, withVenueAccessReadScope } from "@/src/lib/dancr/venue-access";
import { getVenueDancerVerificationState } from "@/src/lib/dancr/venue-affiliations";
import { getVenueClubDealRequests } from "@/src/lib/dancr/venue-deal-requests";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const start = Date.now();
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);

    const admin = createAdminSupabaseClient();
    return await withVenueAccessReadScope(admin, user.id, async () => {
      const access = await requireVenueAccess(admin, user.id, "view_dashboard");

      const accessMs = Date.now() - start;
      const params = new URL(request.url).searchParams;
      const headers = (view: string) => {
        const dataMs = Date.now() - start - accessMs;
        if (accessMs + dataMs >= 1500) console.info(JSON.stringify({ event: "venue.dashboard_timing", view, accessMs, dataMs }));
        return { "Cache-Control": "no-store", "Server-Timing": `access;dur=${accessMs}, ${view};dur=${dataMs}` };
      };
      if (params.get("view") === "summary") {
        const summary = await getVenueDashboardSummary(admin, user.id);
        return NextResponse.json({ ok: true, ...summary, venueAccess: access }, { headers: headers("summary") });
      }
      const period = readVenueAnalyticsPeriod(params.get("period"));

      if (params.get("view") === "analytics") {
        const analytics = await getVenueAnalytics(admin, user.id, period);
        return NextResponse.json({ ok: true, analytics }, { headers: headers("analytics") });
      }

      const [dashboard, verification, dealRequests] = await Promise.all([
        params.get("view") === "operations"
          ? getVenueDashboardOperations(admin, user.id)
          : getVenueDashboard(admin, user.id, period),
        getVenueDancerVerificationState(admin, user.id),
        getVenueClubDealRequests(admin, access.venueId),
      ]);
      return NextResponse.json({
        ok: true,
        ...dashboard,
        affiliations: verification.affiliations,
        venueAccess: access,
        dealRequests,
        refreshedAt: new Date().toISOString(),
      }, { headers: headers(params.get("view") === "operations" ? "operations" : "dashboard") });
    });
  } catch (error) {
    return apiError(error, "Unable to load club dashboard.");
  }
}
