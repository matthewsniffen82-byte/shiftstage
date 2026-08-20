import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { resolveApiError } from "@/src/lib/api-error-policy";
import {
  CashierDealRedemptionError,
  completeCashierDealRedemption,
} from "@/src/lib/dancr/cashier-deal-redemption";
import { DealRedemptionAttributionError } from "@/src/lib/dancr/deal-redemption-attribution";
import { getActiveClubDealsForVenue } from "@/src/lib/dancr/deals";
import {
  registerDancerFromNfc,
  recordNfcTagScan,
  resolveNfcTag,
} from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

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
      const affiliation = await registerDancerFromNfc(admin, {
        tagId: tag.id,
        dancerUserId: user.id,
        sessionId,
        request,
      });
      console.info("DANCER_NFC_AUTHORIZATION_COMPLETED", {
        venueId: tag.venueId,
        tagId: tag.id,
        dancerId: affiliation?.dancerId,
        shiftCheckedIn: affiliation?.shiftCheckedIn === true,
        workingUntil: affiliation?.workingUntil || null,
        nextTapAllowedAt: affiliation?.nextTapAllowedAt || null,
        tapApplied: affiliation?.tapApplied === true,
      });
      return noStore({
        ok: true,
        action: "dancer_check_in",
        affiliation,
        session: authContext.session || null,
        message: affiliation?.enrollmentStatus === "pending"
          ? `Your ${tag.venue.name} NFC affiliation is saved. Finish profile setup and media review; it will activate automatically without a venue QR scan.`
           : affiliation?.alreadyWorking
             ? `You are already Working Now at ${affiliation?.venueName || tag.venue.name}. This tap did not extend the six-hour session.`
           : affiliation?.cooldownActive
             ? `Your Working Now cooldown is active. You can tap again after ${formatTapTime(affiliation?.nextTapAllowedAt)}.`
           : affiliation?.shiftCheckedIn
             ? `You are Working Now at ${tag.venue.name} for six hours. A six-hour cooldown follows, and retaps cannot extend it.`
             : `Verified at ${tag.venue.name}. Your venue affiliation and profile are active.`,
      });
    }

    const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
    const sourceType = body.sourceType === "dancer_profile" ? "dancer_profile" : "club_page";
    const dancerId = typeof body.dancerId === "string" ? body.dancerId.trim() : null;
    const attributionToken = typeof body.attributionToken === "string" ? body.attributionToken.trim() : "";
    const redemption = await completeCashierDealRedemption(admin, {
      venueId: tag.venueId,
      nfcTagId: tag.id,
      dealId,
      sourceType,
      dancerId,
      attributionToken,
      sessionId,
      request,
    });
    console.info("CLUB_DEAL_NFC_REDEEMED", {
      venueId: tag.venueId,
      tagId: tag.id,
      dealId: redemption.deal.id,
      redemptionId: redemption.confirmation?.redemptionId,
      sourceType: redemption.sourceType,
    });
    return noStore({
      ok: true,
      action: "deal_redemption",
      deal: redemption.deal,
      confirmation: redemption.confirmation,
      message: `${redemption.deal.dealTitle} redeemed at ${tag.venue.name}.`,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = error instanceof CashierDealRedemptionError || error instanceof DealRedemptionAttributionError
      ? error.status
      : /sign in|active dancer|different venue|inactive/i.test(message)
        ? 403
        : /already/i.test(message)
          ? 409
          : /not found|no longer active/i.test(message)
            ? 404
            : /invalid|valid|required|missing|expired|incomplete|choose|does not have|cannot include|expiration/i.test(message)
              ? 400
              : 500;
    const resolved = resolveApiError(error, "Unable to complete this NFC tap.", status);
    console.error("NFC_TAP_FAILED", { message });
    return NextResponse.json(resolved.body, {
      status: resolved.status,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }
}

function formatTapTime(value: unknown) {
  if (typeof value !== "string") return "the cooldown ends";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "the cooldown ends";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
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
