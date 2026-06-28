import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubDeal, DealSourceType } from "./types";

type DancrClient = SupabaseClient;

export type DealRedemptionInput = {
  clubDealId: string;
  venueId: string;
  sourceType: DealSourceType;
  dancerId?: string | null;
  customerId?: string | null;
  sessionId?: string | null;
  request: Request;
};

export type DealRedemption = {
  id: string;
  redemptionToken: string;
  redemptionUrl: string;
  expiresAt: string;
};

export async function getActiveClubDealForVenue(client: DancrClient, venueId: string): Promise<ClubDeal | null> {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select(
      "id, venue_id, deal_title, deal_description, deal_terms, is_active, valid_days, valid_start_time, valid_end_time, redemption_rules, payout_type, payout_amount_cents",
    )
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toClubDeal(data) : null;
}

export async function dancerHasActiveShiftAtVenue(client: DancrClient, dancerId: string, venueId: string, now = new Date()) {
  const nowIso = now.toISOString();
  const { data, error } = await (client as any)
    .from("shifts")
    .select("id")
    .eq("dancer_id", dancerId)
    .eq("venue_id", venueId)
    .eq("status", "posted")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function createDealRedemption(client: DancrClient, input: DealRedemptionInput): Promise<DealRedemption> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
  const origin = new URL(input.request.url).origin;
  const redemptionUrl = `${origin}/deals/redeem/${token}`;
  const audit = readRequestAudit(input.request);

  const { data, error } = await (client as any)
    .from("qr_redemptions")
    .insert({
      redemption_token: token,
      venue_id: input.venueId,
      club_deal_id: input.clubDealId,
      source_type: input.sourceType,
      dancer_id: input.sourceType === "dancer_profile" ? input.dancerId || null : null,
      customer_id: input.customerId || null,
      session_id: input.sessionId || null,
      expires_at: expiresAt,
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
      audit,
    })
    .select("id, redemption_token, expires_at")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    redemptionToken: data.redemption_token,
    redemptionUrl,
    expiresAt: data.expires_at,
  };
}

export async function getRedemptionForScanner(client: DancrClient, token: string) {
  const { data, error } = await (client as any)
    .from("qr_redemptions")
    .select(
      `
      id,
      redemption_token,
      status,
      source_type,
      dancer_id,
      generated_at,
      expires_at,
      redeemed_at,
      venues(name, city, state),
      club_deals(id, deal_title, deal_description, deal_terms, is_active)
    `,
    )
    .eq("redemption_token", token)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeScannerRedemption(data) : null;
}

export async function redeemDealToken(client: DancrClient, token: string, request: Request, clubUserId?: string | null) {
  const db = client as any;
  const redemption = await getRedemptionForScanner(client, token);
  if (!redemption) return { ok: false, status: 404, error: "QR code not found." };
  if (!redemption.deal?.isActive) return { ok: false, status: 400, error: "This deal is no longer active." };
  if (redemption.status === "voided") return { ok: false, status: 400, error: "This QR code was voided." };
  if (redemption.status === "redeemed") return { ok: false, status: 409, error: "This QR code was already redeemed." };

  if (new Date(redemption.expiresAt).getTime() <= Date.now()) {
    await db.from("qr_redemptions").update({ status: "expired" }).eq("id", redemption.id).eq("status", "generated");
    return { ok: false, status: 400, error: "This QR code has expired." };
  }

  const audit = readRequestAudit(request);
  const { data: updated, error: updateError } = await db
    .from("qr_redemptions")
    .update({
      status: "redeemed",
      redeemed_at: new Date().toISOString(),
      redeemed_by_club_user: clubUserId || null,
      audit: {
        ...redemption.audit,
        redeemed: audit,
      },
    })
    .eq("id", redemption.id)
    .eq("status", "generated")
    .select("id, venue_id, club_deal_id, dancer_id, source_type")
    .maybeSingle();

  if (updateError) throw updateError;
  if (!updated) return { ok: false, status: 409, error: "This QR code was already processed." };

  if (updated.source_type === "dancer_profile" && updated.dancer_id) {
    const { data: deal, error: dealError } = await db
      .from("club_deals")
      .select("payout_type, payout_amount_cents")
      .eq("id", updated.club_deal_id)
      .maybeSingle();

    if (dealError) throw dealError;

    const { error: commissionError } = await db.from("commission_events").insert({
      qr_redemption_id: updated.id,
      venue_id: updated.venue_id,
      club_deal_id: updated.club_deal_id,
      dancer_id: updated.dancer_id,
      status: "pending_club_payment",
      amount_cents: deal?.payout_amount_cents || 0,
      payout_type: deal?.payout_type || "none",
      audit: { source: "qr_redemption" },
    });

    if (commissionError && commissionError.code !== "23505") throw commissionError;
  }

  return { ok: true, status: 200, redemption: await getRedemptionForScanner(client, token) };
}

export async function getDancerDealMetrics(client: DancrClient, userId: string) {
  const db = client as any;
  const { data: profile, error: profileError } = await db
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const [{ data: redemptions, error: redemptionError }, { data: commissions, error: commissionError }] = await Promise.all([
    db
      .from("qr_redemptions")
      .select("id, status, source_type, generated_at, redeemed_at, club_deals(deal_title), venues(name)")
      .eq("dancer_id", profile.id)
      .eq("source_type", "dancer_profile")
      .order("generated_at", { ascending: false })
      .limit(20),
    db
      .from("commission_events")
      .select("id, status, amount_cents, payout_type, created_at, club_deals(deal_title), venues(name)")
      .eq("dancer_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (redemptionError) throw redemptionError;
  if (commissionError) throw commissionError;

  return {
    tokensGenerated: redemptions?.length || 0,
    qrOpens: redemptions?.length || 0,
    redeemed: (redemptions || []).filter((item: any) => item.status === "redeemed").length,
    expiredOrVoided: (redemptions || []).filter((item: any) => item.status === "expired" || item.status === "voided").length,
    pendingCommissions: (commissions || []).filter((item: any) => item.status === "pending_club_payment").length,
    payableCommissions: (commissions || []).filter((item: any) => item.status === "payable").length,
    paidCommissions: (commissions || []).filter((item: any) => item.status === "paid").length,
    rejectedCommissions: (commissions || []).filter((item: any) => item.status === "rejected" || item.status === "voided").length,
    recentRedemptions: redemptions || [],
    recentCommissions: commissions || [],
  };
}

export async function getAdminDealActivity(client: DancrClient, filters: Record<string, string | null>) {
  const db = client as any;
  let query = db
    .from("qr_redemptions")
    .select(
      `
      id,
      redemption_token,
      source_type,
      status,
      generated_at,
      redeemed_at,
      suspicious,
      venues(id, name),
      dancer_profiles(id, stage_name),
      club_deals(id, deal_title),
      commission_events(id, status, amount_cents)
    `,
    )
    .order("generated_at", { ascending: false })
    .limit(40);

  if (filters.venueId) query = query.eq("venue_id", filters.venueId);
  if (filters.dancerId) query = query.eq("dancer_id", filters.dancerId);
  if (filters.dealId) query = query.eq("club_deal_id", filters.dealId);
  if (filters.sourceType) query = query.eq("source_type", filters.sourceType);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.suspicious === "true") query = query.eq("suspicious", true);

  const { data, error } = await query;
  if (error) throw error;

  let activity = data || [];
  if (filters.commissionStatus) {
    activity = activity.filter((item: any) => {
      const commission = readJoinedFirst(item.commission_events);
      return commission?.status === filters.commissionStatus;
    });
  }

  return activity;
}

export async function voidDealRedemption(client: DancrClient, redemptionId: string, adminUserId: string) {
  const db = client as any;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("qr_redemptions")
    .update({
      status: "voided",
      suspicious: true,
      voided_at: now,
      voided_by_admin: adminUserId,
    })
    .eq("id", redemptionId)
    .neq("status", "voided")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { error: commissionError } = await db
    .from("commission_events")
    .update({
      status: "voided",
      voided_at: now,
      audit: { voided_by_admin: adminUserId, reason: "admin_voided_redemption" },
    })
    .eq("qr_redemption_id", redemptionId)
    .neq("status", "paid");

  if (commissionError) throw commissionError;
  return data;
}

function toClubDeal(row: any): ClubDeal {
  return {
    id: row.id,
    venueId: row.venue_id,
    dealTitle: row.deal_title,
    dealDescription: row.deal_description,
    dealTerms: row.deal_terms,
    isActive: row.is_active,
    validDays: row.valid_days,
    validStartTime: row.valid_start_time,
    validEndTime: row.valid_end_time,
    redemptionRules: row.redemption_rules || {},
    payoutType: row.payout_type || "none",
    payoutAmountCents: row.payout_amount_cents || 0,
  };
}

function normalizeScannerRedemption(row: any) {
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
  const deal = Array.isArray(row.club_deals) ? row.club_deals[0] : row.club_deals;

  return {
    id: row.id,
    redemptionToken: row.redemption_token,
    status: row.status,
    sourceType: row.source_type,
    dancerId: row.dancer_id,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    venue: venue ? { name: venue.name, city: venue.city, state: venue.state } : null,
    deal: deal
      ? {
          id: deal.id,
          dealTitle: deal.deal_title,
          dealDescription: deal.deal_description,
          dealTerms: deal.deal_terms,
          isActive: deal.is_active,
        }
      : null,
    audit: row.audit || {},
  };
}

function readJoinedFirst(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) || null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function readRequestAudit(request: Request) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent") || null,
    deviceFingerprint: request.headers.get("x-dancr-device") || null,
  };
}
