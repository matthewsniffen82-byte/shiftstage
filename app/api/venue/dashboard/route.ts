import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueDashboard, getVenueDashboardSummary, readVenueAnalyticsPeriod } from "@/src/lib/dancr/venue";
import { requireVenueAccess, withVenueAccessReadScope } from "@/src/lib/dancr/venue-access";
import { getVenueDancerVerificationState } from "@/src/lib/dancr/venue-affiliations";
import { getVenueClubDealRequests } from "@/src/lib/dancr/venue-deal-requests";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);

    const admin = createAdminSupabaseClient();
    return await withVenueAccessReadScope(admin, user.id, async () => {
      const access = await requireVenueAccess(admin, user.id, "view_dashboard");

      const params = new URL(request.url).searchParams;
      if (params.get("view") === "summary") {
        const summary = await getVenueDashboardSummary(admin, user.id);
        return NextResponse.json({ ok: true, ...summary, venueAccess: access }, { headers: { "Cache-Control": "no-store" } });
      }
      const period = readVenueAnalyticsPeriod(params.get("period"));

      const [dashboard, verification, dealRequests] = await Promise.all([
        getVenueDashboard(admin, user.id, period),
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
      });
    });
  } catch (error) {
    return apiError(error, "Unable to load venue dashboard.");
  }
}
