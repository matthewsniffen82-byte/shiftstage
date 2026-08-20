import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueFinance } from "@/src/lib/dancr/finance-reporting";
import { getVenueDashboard, readVenueAnalyticsPeriod } from "@/src/lib/dancr/venue";
import { canVenue, requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { getVenueDancerVerificationState } from "@/src/lib/dancr/venue-affiliations";
import { getLatestVenueOwnershipClaim } from "@/src/lib/dancr/venue-claims";
import { getVenueReferralFeeState } from "@/src/lib/dancr/referral-fees";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);

    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "view_dashboard").catch(() => null);
    const claim = await getLatestVenueOwnershipClaim(admin, user.id);
    if (!access && (claim?.status === "pending" || claim?.status === "rejected")) {
      return NextResponse.json({ ok: true, profile: null, claim });
    }
    if (!access) {
      return NextResponse.json({ ok: false, error: "No active venue is connected to this account." }, { status: 403 });
    }

    const period = readVenueAnalyticsPeriod(new URL(request.url).searchParams.get("period"));

    const [dashboard, finance, verification, referralFee] = await Promise.all([
      getVenueDashboard(admin, user.id, period),
      canVenue(access, "view_finance") ? getVenueFinance(admin, user.id) : null,
      getVenueDancerVerificationState(admin, user.id),
      getVenueReferralFeeState(admin, access.venueId),
    ]);
    return NextResponse.json({
      ok: true,
      ...dashboard,
      finance,
      affiliations: verification.affiliations,
      venueAccess: access,
      referralFee,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(error, "Unable to load venue dashboard.");
  }
}
