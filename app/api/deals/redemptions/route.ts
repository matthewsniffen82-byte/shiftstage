import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { apiError } from "@/src/lib/api";
import { createDealRedemption, dancerHasActiveShiftAtVenue, getActiveClubDealForVenue } from "@/src/lib/dancr/deals";
import type { DealSourceType } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = new Set(["club_page", "dancer_profile"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clubDealId = typeof body?.clubDealId === "string" ? body.clubDealId.trim() : "";
    const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : "";
    const sourceType = typeof body?.sourceType === "string" ? body.sourceType.trim() : "";
    const dancerId = typeof body?.dancerId === "string" ? body.dancerId.trim() : null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : null;

    if (!clubDealId || !venueId || !SOURCES.has(sourceType)) {
      return NextResponse.json({ ok: false, error: "Missing deal, venue, or source." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    await enforceGenerationRateLimit(admin, request, clubDealId);

    const deal = await getActiveClubDealForVenue(admin, venueId);
    if (!deal || deal.id !== clubDealId) {
      return NextResponse.json({ ok: false, error: "This club deal is not active." }, { status: 404 });
    }

    if (sourceType === "dancer_profile") {
      if (!dancerId) {
        return NextResponse.json({ ok: false, error: "Missing dancer attribution." }, { status: 400 });
      }

      const hasActiveShift = await dancerHasActiveShiftAtVenue(admin, dancerId, venueId);
      if (!hasActiveShift) {
        return NextResponse.json({ ok: false, error: "This dancer does not have an active shift at this venue." }, { status: 400 });
      }
    }

    const redemption = await createDealRedemption(admin, {
      clubDealId,
      venueId,
      sourceType: sourceType as DealSourceType,
      dancerId,
      sessionId,
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

async function enforceGenerationRateLimit(admin: any, request: Request, clubDealId: string) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  if (!ipAddress) return;

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("qr_redemptions")
    .select("*", { count: "exact", head: true })
    .eq("club_deal_id", clubDealId)
    .eq("ip_address", ipAddress)
    .gte("generated_at", since);

  if (error) throw error;
  if ((count || 0) >= 20) {
    throw new Error("Too many QR requests. Try again in a few minutes.");
  }
}
