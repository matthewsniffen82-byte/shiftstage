import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { verifyDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import {
  createDealRedemption,
  enforceDealGenerationRateLimit,
  getActiveClubDealByIdForVenue,
  getActiveClubDealsForVenue,
  getVerifiedActiveCheckInAtVenue,
} from "@/src/lib/dancr/deals";
import {
  checkInDancerFromNfc,
  confirmRedemptionFromNfc,
  recordNfcTagScan,
  resolveNfcTag,
} from "@/src/lib/dancr/nfc";
import type { DealSourceType } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext, getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const admin = createAdminSupabaseClient();
    const tag = await resolveNfcTag(admin, token);
    if (!tag) return inactiveTag();
    await recordNfcTagScan(admin, tag.id);
    const deals = tag.type === "cashier" ? await getActiveClubDealsForVenue(admin, tag.venueId) : [];
    return noStore({
      ok: true,
      tag: { id: tag.id, type: tag.type, label: tag.label },
      venue: tag.venue,
      deals,
    });
  } catch (error) {
    return apiError(error, "Unable to open this venue NFC tag.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const body = await readBody(request);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!UUID_PATTERN.test(sessionId)) {
      return NextResponse.json({ ok: false, error: "A valid tap session is required." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient();
    const tag = await resolveNfcTag(admin, token);
    if (!tag) return inactiveTag();

    if (tag.type === "dressing_room") {
      const authContext = await createRequestSupabaseContext(request);
      const { client, user } = authContext;
      const { data: account, error } = await client
        .from("app_users")
        .select("role, account_state")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (account?.role !== "dancer" || account?.account_state !== "active") {
        return NextResponse.json({ ok: false, error: "Sign in with an active dancer account to use this tag." }, { status: 403 });
      }
      const { data: dancer, error: dancerError } = await admin
        .from("dancer_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (dancerError) throw dancerError;
      const { data: approvedAffiliation, error: affiliationError } = dancer?.id
        ? await admin
            .from("venue_dancer_affiliations")
            .select("id")
            .eq("dancer_id", dancer.id)
            .eq("venue_id", tag.venueId)
            .eq("status", "active")
            .maybeSingle()
        : { data: null, error: null };
      if (affiliationError) throw affiliationError;
      if (!approvedAffiliation) {
        return NextResponse.json({
          ok: false,
          error: `A verified ${tag.venue.name} manager must scan your dancer approval QR before this dressing-room NFC sticker can check you in.`,
        }, { status: 403 });
      }
      const affiliation = await checkInDancerFromNfc(admin, {
        tagId: tag.id,
        dancerUserId: user.id,
        sessionId,
        request,
      });
      console.info("DANCER_NFC_CHECKIN_VERIFIED", {
        venueId: tag.venueId,
        tagId: tag.id,
        dancerId: affiliation?.dancerId,
        shiftCheckedIn: affiliation?.shiftCheckedIn === true,
      });
      return noStore({
        ok: true,
        action: "dancer_affiliation",
        affiliation,
        session: authContext.session || null,
        message: affiliation?.shiftCheckedIn
          ? `Verified at ${tag.venue.name}. Your profile is live and your current shift is checked in.`
          : `Verified at ${tag.venue.name}. Your manager-approved venue affiliation is active.`,
      });
    }

    const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
    const sourceType = body.sourceType === "dancer_profile" ? "dancer_profile" : "club_page";
    const dancerId = typeof body.dancerId === "string" ? body.dancerId.trim() : null;
    const attributionToken = typeof body.attributionToken === "string" ? body.attributionToken.trim() : "";
    if (!UUID_PATTERN.test(dealId)) {
      return NextResponse.json({ ok: false, error: "Choose an active Club Deal." }, { status: 400 });
    }
    await enforceDealGenerationRateLimit(admin, request, dealId);
    const deal = await getActiveClubDealByIdForVenue(admin, tag.venueId, dealId);
    if (!deal) return NextResponse.json({ ok: false, error: "This Club Deal is no longer active." }, { status: 404 });

    let shiftId: string | null = null;
    if (sourceType === "dancer_profile") {
      if (!dancerId || !UUID_PATTERN.test(dancerId) || !attributionToken) {
        return NextResponse.json({ ok: false, error: "The dancer attribution is missing. Reopen the dancer profile." }, { status: 400 });
      }
      const attribution = verifyDancerDealAttributionToken(attributionToken);
      if (!attribution || attribution.dancerId !== dancerId || attribution.venueId !== tag.venueId || attribution.dealId !== dealId) {
        return NextResponse.json({ ok: false, error: "The dancer attribution expired. Reopen the dancer profile." }, { status: 400 });
      }
      const verifiedCheckIn = await getVerifiedActiveCheckInAtVenue(admin, dancerId, tag.venueId);
      if (!verifiedCheckIn || verifiedCheckIn.shiftId !== attribution.shiftId) {
        return NextResponse.json({ ok: false, error: "The dancer is no longer verified at this venue." }, { status: 409 });
      }
      shiftId = verifiedCheckIn.shiftId;
    }

    const customerId = await optionalCustomerId(request, admin);
    const redemption = await createDealRedemption(admin, {
      clubDealId: deal.id,
      venueId: tag.venueId,
      dealTitle: deal.dealTitle,
      dealDescription: deal.dealDescription,
      dealTerms: deal.dealTerms,
      dealOfferType: deal.offerType,
      dealBookingUrl: deal.bookingUrl,
      sourceType: sourceType as DealSourceType,
      dancerId,
      shiftId,
      customerId,
      sessionId,
      campaignSource: "venue_nfc",
      nfcTagId: tag.id,
      request,
    });
    try {
      const confirmation = await confirmRedemptionFromNfc(admin, {
        tagId: tag.id,
        redemptionToken: redemption.redemptionToken,
        sessionId,
        request,
      });
      console.info("CLUB_DEAL_NFC_REDEEMED", {
        venueId: tag.venueId,
        tagId: tag.id,
        dealId: deal.id,
        redemptionId: confirmation?.redemptionId,
        sourceType,
      });
      return noStore({
        ok: true,
        action: "deal_redemption",
        deal,
        confirmation,
        message: `${deal.dealTitle} redeemed at ${tag.venue.name}.`,
      });
    } catch (error) {
      await (admin as any)
        .from("qr_redemptions")
        .update({ status: "voided", suspicious: false, voided_at: new Date().toISOString() })
        .eq("id", redemption.id)
        .eq("status", "generated");
      throw error;
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = /sign in|active dancer|different venue|inactive/i.test(message)
      ? 403
      : /already/i.test(message)
        ? 409
        : /not found|no longer active/i.test(message)
          ? 404
          : 400;
    console.error("NFC_TAP_FAILED", { message });
    return NextResponse.json({ ok: false, error: message || "Unable to complete this NFC tap." }, { status });
  }
}

async function optionalCustomerId(request: Request, admin: ReturnType<typeof createAdminSupabaseClient>) {
  if (!getBearerToken(request)) return null;
  try {
    const { user } = await createRequestSupabaseContext(request);
    const { data, error } = await admin.from("app_users").select("role, account_state").eq("id", user.id).maybeSingle();
    if (error) throw error;
    return data?.role === "customer" && data?.account_state === "active" ? user.id : null;
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function inactiveTag() {
  return NextResponse.json(
    { ok: false, error: "This NFC tag is inactive. Ask venue staff for the current MyDancr tag." },
    { status: 410, headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0" } });
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unable to complete this NFC tap.";
}
