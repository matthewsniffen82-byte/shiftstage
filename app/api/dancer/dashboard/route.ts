import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getDancerAgeVerification } from "@/src/lib/dancr/ondato";
import { getDancerAgreementAccess } from "@/src/lib/dancr/dancer-agreement";
import { broadcastFollowedClubRosterAddition } from "@/src/lib/dancr/customer-follow-notifications";
import { dancerAnalyticsPeriod, getOwnDancerAudienceAnalytics } from "@/src/lib/dancr/dancer-audience-analytics";
import { getOwnDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { getDancerDealMetrics } from "@/src/lib/dancr/deals";
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
    const requestedPeriod = new URL(request.url).searchParams.get("period");
    if (requestedPeriod !== null && requestedPeriod !== "7d" && requestedPeriod !== "30d") {
      return NextResponse.json({ ok: false, error: "Choose a 7-day or 30-day analytics period." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient();
    const ageVerification = await getDancerAgeVerification(admin, user.id);
    const agreement = await getDancerAgreementAccess(client);
    const nfcEnrollment = !agreement.accepted || (ageVerification.required && ageVerification.status !== "verified") ? null : await finalizePendingDancerNfcEnrollment(admin, {
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
    // Keep the response used by older shell clients stable. The current
    // dashboard explicitly requests a period and skips retired deal metrics.
    const [analytics, deals, nfc] = await Promise.all([
      requestedPeriod === null
        ? getOwnDancerDashboardAnalytics(client, user.id, admin)
        : getOwnDancerAudienceAnalytics(admin, user.id, dancerAnalyticsPeriod(requestedPeriod)),
      requestedPeriod === null ? getDancerDealMetrics(client, user.id, admin) : Promise.resolve(null),
      getDancerNfcDashboardState(admin, user.id),
    ]);

    return NextResponse.json({
      ok: true,
      analytics,
      ...(requestedPeriod === null ? { deals } : {}),
      nfc: {
        ...nfc,
        enrollment: nfc.enrollment || nfcEnrollment || null,
      },
      affiliations: nfc.affiliations,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
