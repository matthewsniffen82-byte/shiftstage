import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { apiError } from "@/src/lib/api";
import { verifyDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import { verifyVenueDealCampaignToken } from "@/src/lib/dancr/deal-campaign";
import {
  createDealRedemption,
  enforceDealGenerationRateLimit,
  getVerifiedActiveCheckInAtVenue,
  getActiveClubDealByIdForVenue,
} from "@/src/lib/dancr/deals";
import type { DealSourceType } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext, getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = new Set(["club_page", "dancer_profile"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clubDealId = typeof body?.clubDealId === "string" ? body.clubDealId.trim() : "";
    const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : "";
    const sourceType = typeof body?.sourceType === "string" ? body.sourceType.trim() : "";
    const dancerId = typeof body?.dancerId === "string" ? body.dancerId.trim() : null;
    const attributionToken = typeof body?.attributionToken === "string"
      ? body.attributionToken.trim()
      : "";
    const campaignToken = typeof body?.campaignToken === "string"
      ? body.campaignToken.trim()
      : "";
    const sessionId = typeof body?.sessionId === "string" && UUID_PATTERN.test(body.sessionId.trim())
      ? body.sessionId.trim()
      : null;

    if (!UUID_PATTERN.test(clubDealId) || !UUID_PATTERN.test(venueId) || !SOURCES.has(sourceType)) {
      return NextResponse.json({ ok: false, error: "Missing deal, venue, or source." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    await enforceDealGenerationRateLimit(admin, request, clubDealId);

    const deal = await getActiveClubDealByIdForVenue(admin, venueId, clubDealId);
    if (!deal) {
      return NextResponse.json({ ok: false, error: "This club deal is not active." }, { status: 404 });
    }

    let shiftId: string | null = null;
    let campaignSource: "venue_qr" | null = null;
    if (sourceType === "dancer_profile") {
      if (!dancerId || !attributionToken) {
        return NextResponse.json({ ok: false, error: "Missing dancer attribution." }, { status: 400 });
      }

      if (!UUID_PATTERN.test(dancerId)) {
        return NextResponse.json({ ok: false, error: "Invalid dancer attribution." }, { status: 400 });
      }

      const attribution = verifyDancerDealAttributionToken(attributionToken);
      if (
        !attribution ||
        attribution.dancerId !== dancerId ||
        attribution.venueId !== venueId ||
        attribution.dealId !== clubDealId
      ) {
        return NextResponse.json({ ok: false, error: "Invalid or expired dancer attribution." }, { status: 400 });
      }

      const verifiedCheckIn = await getVerifiedActiveCheckInAtVenue(admin, dancerId, venueId);
      if (!verifiedCheckIn) {
        return NextResponse.json(
          { ok: false, error: "This Club Deal is available from the dancer profile only during a verified check-in." },
          { status: 400 },
        );
      }
      if (verifiedCheckIn.shiftId !== attribution.shiftId) {
        return NextResponse.json({ ok: false, error: "The verified dancer check-in changed. Refresh the profile." }, { status: 409 });
      }
      shiftId = verifiedCheckIn.shiftId;
    } else if (campaignToken) {
      const campaign = verifyVenueDealCampaignToken(campaignToken);
      if (!campaign || campaign.dealId !== clubDealId || campaign.venueId !== venueId) {
        return NextResponse.json({ ok: false, error: "Invalid tracked venue QR." }, { status: 400 });
      }
      campaignSource = "venue_qr";
    }

    const customerId = await optionalCustomerId(request, admin);
    const redemption = await createDealRedemption(admin, {
      clubDealId,
      venueId,
      sourceType: sourceType as DealSourceType,
      dancerId,
      shiftId,
      customerId,
      sessionId,
      campaignSource,
      request,
    });
    const qrDataUrl = await QRCode.toDataURL(redemption.redemptionUrl, {
      margin: 1,
      width: 420,
      color: {
        dark: "#050505",
        light: "#ffffff",
      },
    });

    return NextResponse.json({ ok: true, deal, redemption, qrDataUrl });
  } catch (error) {
    return apiError(error, "Unable to create deal QR.");
  }
}

async function optionalCustomerId(
  request: Request,
  admin: ReturnType<typeof createAdminSupabaseClient>,
) {
  if (!getBearerToken(request)) return null;
  try {
    const { user } = await createRequestSupabaseContext(request);
    const { data, error } = await admin
      .from("app_users")
      .select("role, account_state")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data?.role === "customer" && data?.account_state === "active" ? user.id : null;
  } catch {
    return null;
  }
}
