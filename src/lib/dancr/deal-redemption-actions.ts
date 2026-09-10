import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enforcePublicRequestRateLimit } from "./public-request-rate-limit";
import type { ClubDealOfferType, DealSourceType } from "./types";

type DancrClient = SupabaseClient;

export type DealRedemptionInput = {
  clubDealId: string;
  venueId: string;
  dealTitle: string;
  dealDescription: string;
  dealTerms?: string | null;
  dealOfferType: ClubDealOfferType;
  sourceType: DealSourceType;
  dancerId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  sessionId?: string | null;
  campaignSource?: "venue_qr" | "venue_nfc" | null;
  nfcTagId?: string | null;
  request: Request;
};

export type DealLifecycleEventType = "saved" | "shared" | "scanner_opened";

export async function issueAndConfirmDealRedemptionFromNfc(
  client: DancrClient,
  input: DealRedemptionInput & { nfcTagId: string; sessionId: string },
) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
  const audit = readRequestAudit(input.request);
  const { data, error } = await (client as any).rpc("issue_and_confirm_deal_redemption_from_nfc", {
    p_redemption_token: token,
    p_tag_id: input.nfcTagId,
    p_session_id: input.sessionId,
    p_venue_id: input.venueId,
    p_club_deal_id: input.clubDealId,
    p_source_type: input.sourceType,
    p_dancer_id: input.sourceType === "dancer_profile" ? input.dancerId || null : null,
    p_shift_id: input.sourceType === "dancer_profile" ? input.shiftId || null : null,
    p_customer_id: input.customerId || null,
    p_expires_at: expiresAt,
    p_audit: {
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
      campaign_source: input.campaignSource || null,
      deal_snapshot: issuedDealSnapshot(input),
    },
  });
  if (error) throw error;
  return data;
}

export async function enforceDealGenerationRateLimit(
  client: DancrClient,
  request: Request,
  clubDealId: string,
  sessionId: string,
) {
  await enforcePublicRequestRateLimit(client, {
    namespace: "deal_redemption",
    request,
    subject: `${clubDealId}:${sessionId}`,
    windowSeconds: 5 * 60,
    ipLimit: 120,
    subjectLimit: 5,
  });
}

export async function recordDealRedemptionEvent(
  client: DancrClient,
  token: string,
  eventType: DealLifecycleEventType,
  request: Request,
  input?: { actorUserId?: string | null; sessionId?: string | null },
) {
  const audit = readRequestAudit(request);
  const { data, error } = await (client as any).rpc("record_deal_lifecycle_event_safely", {
    p_token: token,
    p_event_type: eventType,
    p_actor_user_id: input?.actorUserId || null,
    p_session_id: input?.sessionId || null,
    p_ip_address: audit.ipAddress,
    p_user_agent: audit.userAgent,
    p_device_fingerprint: audit.deviceFingerprint,
  });
  if (error) throw error;
  if (data === null) return null;
  if (!data || typeof data.id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)
    || data.eventType !== eventType || !["generated", "redeemed", "expired", "voided"].includes(data.status)) {
    throw new Error("QR activity could not be confirmed.");
  }
  return { id: data.id, eventType, status: data.status };
}

function issuedDealSnapshot(
  input: Pick<DealRedemptionInput, "dealTitle" | "dealDescription" | "dealTerms" | "dealOfferType">,
) {
  return {
    dealTitle: input.dealTitle,
    dealDescription: input.dealDescription,
    dealTerms: input.dealTerms || null,
    offerType: input.dealOfferType,
    bookingUrl: null,
  };
}

function readRequestAudit(request: Request) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent") || null,
    deviceFingerprint: request.headers.get("x-dancr-device") || null,
  };
}
