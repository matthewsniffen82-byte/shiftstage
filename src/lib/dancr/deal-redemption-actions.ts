import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
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
) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip");
  if (!ipAddress) return;

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count, error } = await (client as any)
    .from("qr_redemptions")
    .select("*", { count: "exact", head: true })
    .eq("club_deal_id", clubDealId)
    .eq("ip_address", ipAddress)
    .gte("generated_at", since);

  if (error) throw error;
  if ((count || 0) >= 20) {
    throw new Error("Too many Club Deal requests. Try again in a few minutes.");
  }
}

export async function recordDealRedemptionEvent(
  client: DancrClient,
  token: string,
  eventType: DealLifecycleEventType,
  request: Request,
  input?: { actorUserId?: string | null; sessionId?: string | null },
) {
  const db = client as any;
  const { data: redemption, error: redemptionError } = await db
    .from("qr_redemptions")
    .select("id, status")
    .eq("redemption_token", token)
    .maybeSingle();
  if (redemptionError) throw redemptionError;
  if (!redemption) return null;

  const audit = readRequestAudit(request);
  const column = eventType === "saved"
    ? "saved_at"
    : eventType === "shared"
      ? "shared_at"
      : "first_scanned_at";
  const now = new Date().toISOString();

  await db
    .from("qr_redemptions")
    .update({ [column]: now })
    .eq("id", redemption.id)
    .is(column, null);

  const { error } = await db.from("qr_redemption_events").insert({
    qr_redemption_id: redemption.id,
    event_type: eventType,
    actor_user_id: input?.actorUserId || null,
    session_id: input?.sessionId || null,
    ip_address: audit.ipAddress,
    user_agent: audit.userAgent,
    audit: { device_fingerprint: audit.deviceFingerprint },
  });
  if (error) throw error;

  return { id: redemption.id, eventType, status: redemption.status };
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
