import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PublicApiError } from "../api-error-policy";
import { resolveDealRedemptionAttribution, DealRedemptionAttributionError } from "./deal-redemption-attribution";
import { getActiveClubDealById } from "./deals";
import { isEligibleClubTransportation } from "./club-deal-transportation";
import { enforceDealGenerationRateLimit } from "./deal-redemption-actions";
import { PublicRequestRateLimitError } from "./public-request-rate-limit";
import { createAdminSupabaseClient } from "../supabase/admin";
import { createRequestSupabaseContext, getBearerToken } from "../supabase/request";
import { readVenueVideo } from "./venue-video-attribution";

export const ADMISSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = "mydancrAdmissionSession";
export const PASS_HEADERS = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };

export async function createAdmissionPass(request: Request, body: Record<string, unknown>) {
  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId) || !isEligibleClubTransportation(body.transportation)
    || !["club_page", "dancer_profile"].includes(String(body.sourceType || "club_page"))) {
    throw new PublicApiError("INVALID_REQUEST", "Choose an offer and eligible arrival method.", 400);
  }
  // Guest identity comes from a private server-issued cookie, never a body ID.
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  const sessionId = cookie && UUID.test(cookie) ? cookie : randomUUID();
  const admin = createAdminSupabaseClient();
  await enforceDealGenerationRateLimit(admin, request, dealId, sessionId);
  let customerId: string | null = null;
  let session;
  if (getBearerToken(request)) {
    const context = await createRequestSupabaseContext(request, { role: "customer" });
    customerId = context.user.id;
    session = context.session;
  }
  const deal = await getActiveClubDealById(admin, dealId);
  if (!deal) throw new PublicApiError("NOT_FOUND", "This offer is no longer available.", 404);
  const attribution = await resolveDealRedemptionAttribution(admin, {
    sourceType: body.sourceType === "dancer_profile" ? "dancer_profile" : "club_page",
    dancerId: typeof body.dancerId === "string" ? body.dancerId : null,
    attributionToken: typeof body.attributionToken === "string" ? body.attributionToken : "",
    venueId: deal.venueId, dealId,
  });
  const { data, error } = await (admin as any).rpc("issue_video_admission_pass", {
    p_token: randomBytes(32).toString("base64url"), p_deal_id: dealId,
    p_session_id: sessionId, p_customer_id: customerId,
    p_source: attribution.sourceType, p_dancer_id: attribution.dancerId,
    p_shift_id: attribution.shiftId, p_arrival_method: body.transportation,
    p_video_id: readVenueVideo(request, deal.venueId, process.env.DANCR_PUBLIC_RATE_LIMIT_SECRET),
  });
  if (error) throw error;
  if (!data?.token || !ADMISSION_TOKEN_PATTERN.test(data.token)) throw new Error("Admission pass receipt missing.");
  const response = NextResponse.json({ ok: true, passUrl: `/deals/pass/${data.token}`, expiresAt: data.expiresAt, session: session || null }, { headers: PASS_HEADERS });
  response.cookies.set(COOKIE, sessionId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  return response;
}

export function admissionError(error: unknown) {
  if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { ...PASS_HEADERS, "retry-after": String(error.retryAfterSeconds) } });
  if (error instanceof DealRedemptionAttributionError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers: PASS_HEADERS });
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const publicMessages = new Set([
    "Check the admission pass details.", "This offer is no longer available.", "This venue is unavailable.",
    "This admission pass is unavailable.", "This admission pass has expired or is no longer valid.",
    "Verify the guest arrival method before admitting them.", "This offer is outside its valid admission hours.",
    "This offer is not valid on this admission date.",
  ]);
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (["22023", "23505", "42501"].includes(code)) return NextResponse.json({ ok: false, error: code === "23505" ? "Admission has already been redeemed at this venue in the last 24 hours." : code === "42501" ? "Only authorized staff for this venue can redeem this pass." : publicMessages.has(message) ? message : "This admission pass is unavailable." }, { status: code === "23505" ? 409 : code === "42501" ? 403 : 400, headers: PASS_HEADERS });
  return null;
}
