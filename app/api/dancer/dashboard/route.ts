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
    const params = new URL(request.url).searchParams;
    const bootstrapOnly = params.get("view") === "bootstrap";
    const requestedPeriod = params.get("period");
    if (requestedPeriod !== null && requestedPeriod !== "auto" && requestedPeriod !== "shift" && requestedPeriod !== "tonight" && requestedPeriod !== "7d" && requestedPeriod !== "30d" && requestedPeriod !== "all") {
      return NextResponse.json({ ok: false, error: "Choose Current shift, Tonight, 7 days, 30 days or All time." }, { status: 400 });
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
    // Opening the dashboard must never start or wait for optional reports.
    // Results load independently after the verified profile is available.
    // Keep report responses stable for older clients that still request them.
    const includeLegacyReports = !bootstrapOnly && requestedPeriod === null;
    const [analytics, deals, nfc] = await Promise.all([
      bootstrapOnly ? Promise.resolve(null) : requestedPeriod === null
        ? getOwnDancerDashboardAnalytics(client, user.id, admin)
        : getOwnDancerAudienceAnalytics(admin, user.id, dancerAnalyticsPeriod(requestedPeriod)).catch((analyticsError) => {
          // Results retry independently; a report failure must not hide profile
          // controls after account, agreement and activation checks succeed.
          console.warn("DANCER_DASHBOARD_ANALYTICS_UNAVAILABLE", safeErrorMetadata(analyticsError));
          return null;
        }),
      includeLegacyReports ? getDancerDealMetrics(client, user.id, admin) : Promise.resolve(null),
      getDancerNfcDashboardState(admin, user.id),
    ]);

    return NextResponse.json({
      ok: true,
      agreement,
      analytics,
      ...(includeLegacyReports ? { deals } : {}),
      // Completion returns a command receipt, including { enrollmentStatus: "none" }.
      // Only the subsequent database read can confirm a saved club tap.
      nfc,
      affiliations: nfc.affiliations,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load dancer dashboard.");
  }
}
