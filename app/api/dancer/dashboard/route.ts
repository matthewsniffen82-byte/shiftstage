import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { broadcastFollowedClubRosterAddition } from "@/src/lib/dancr/customer-follow-notifications";
import { getDancerDealMetrics } from "@/src/lib/dancr/deals";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { getDancerFinance } from "@/src/lib/dancr/finance-reporting";
import { finalizePendingDancerNfcEnrollment, getDancerNfcDashboardState } from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "dancer" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
    }
    const admin = createAdminSupabaseClient();
    const nfcEnrollment = await finalizePendingDancerNfcEnrollment(admin, {
      dancerUserId: user.id,
      request,
    });
    if (nfcEnrollment?.affiliationActivated === true && nfcEnrollment?.id && nfcEnrollment?.dancerId && nfcEnrollment?.venueId) {
      await broadcastFollowedClubRosterAddition(admin, {
        dancerId: String(nfcEnrollment.dancerId),
        eventId: String(nfcEnrollment.id),
        stageName: String(nfcEnrollment.stageName || "A new dancer"),
        venueId: String(nfcEnrollment.venueId),
        venueName: String(nfcEnrollment.venueName || "a club you follow"),
        venueSlug: nfcEnrollment.venueSlug ? String(nfcEnrollment.venueSlug) : null,
      }).catch((notificationError) => {
        console.warn("CUSTOMER_ROSTER_NOTIFICATION_FAILED", safeErrorMetadata(notificationError));
      });
    }
    const [analytics, deals, finance, nfc] = await Promise.all([
      getOwnDancerDashboardAnalytics(client, user.id),
      getDancerDealMetrics(client, user.id),
      getDancerFinance(admin, user.id),
      getDancerNfcDashboardState(admin, user.id),
    ]);

    return NextResponse.json({
      ok: true,
      analytics,
      deals,
      finance,
      nfc: {
        ...nfc,
        enrollment: nfc.enrollment || nfcEnrollment || null,
      },
      affiliations: nfc.affiliations,
    });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
