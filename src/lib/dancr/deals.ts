import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubDeal, ClubDealOfferType, DealSourceType } from "./types";
import { isCurrentLocationVerification } from "./geofence";
import { dancerHasActiveVenueAffiliation } from "./venue-affiliations";
import { requireVenueAccess } from "./venue-access";

type DancrClient = SupabaseClient;

const CLUB_DEAL_COLUMNS =
  "id, venue_id, deal_title, deal_description, deal_terms, is_active, valid_days, valid_start_time, valid_end_time, redemption_rules, payout_type, payout_amount_cents, currency, offer_type, booking_url, sort_order, created_at";

export type DealRedemptionInput = {
  clubDealId: string;
  venueId: string;
  dealTitle: string;
  dealDescription: string;
  dealTerms?: string | null;
  dealOfferType: ClubDealOfferType;
  dealBookingUrl?: string | null;
  sourceType: DealSourceType;
  dancerId?: string | null;
  shiftId?: string | null;
  customerId?: string | null;
  sessionId?: string | null;
  campaignSource?: "venue_qr" | "venue_nfc" | null;
  nfcTagId?: string | null;
  request: Request;
};

export type DealRedemption = {
  id: string;
  redemptionToken: string;
  redemptionUrl: string;
  expiresAt: string;
};

export type DealLifecycleEventType = "saved" | "shared" | "scanner_opened";

export type VenueDealInput = {
  dealId?: string | null;
  dealTitle: string;
  dealDescription: string;
  dealTerms?: string | null;
  referralCommissionCents: number;
  isActive: boolean;
  offerType: ClubDealOfferType;
  bookingUrl?: string | null;
  sortOrder?: number;
};

export async function getActiveClubDealForVenue(client: DancrClient, venueId: string): Promise<ClubDeal | null> {
  const deals = await getActiveClubDealsForVenue(client, venueId);
  return deals[0] || null;
}

export async function getActiveClubDealsForVenue(client: DancrClient, venueId: string): Promise<ClubDeal[]> {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select(CLUB_DEAL_COLUMNS)
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .eq("payout_type", "flat")
    .gt("payout_amount_cents", 0)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data || []).map(toClubDeal);
}

export async function getActiveClubDealByIdForVenue(
  client: DancrClient,
  venueId: string,
  dealId: string,
): Promise<ClubDeal | null> {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select(CLUB_DEAL_COLUMNS)
    .eq("id", dealId)
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .eq("payout_type", "flat")
    .gt("payout_amount_cents", 0)
    .maybeSingle();

  if (error) throw error;
  return data ? toClubDeal(data) : null;
}

export async function getActiveClubDealById(
  client: DancrClient,
  dealId: string,
): Promise<ClubDeal | null> {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select(CLUB_DEAL_COLUMNS)
    .eq("id", dealId)
    .eq("is_active", true)
    .eq("payout_type", "flat")
    .gt("payout_amount_cents", 0)
    .maybeSingle();

  if (error) throw error;
  return data ? toClubDeal(data) : null;
}

export async function getActiveClubDealsForVenues(client: DancrClient, venueIds: string[]): Promise<Map<string, ClubDeal>> {
  const lists = await getActiveClubDealListsForVenues(client, venueIds);
  const firstDeals = new Map<string, ClubDeal>();
  for (const [venueId, deals] of lists) {
    if (deals[0]) firstDeals.set(venueId, deals[0]);
  }
  return firstDeals;
}

export async function getActiveClubDealListsForVenues(
  client: DancrClient,
  venueIds: string[],
): Promise<Map<string, ClubDeal[]>> {
  const uniqueVenueIds = [...new Set(venueIds.filter(Boolean))];
  if (!uniqueVenueIds.length) return new Map();

  const { data, error } = await (client as any)
    .from("club_deals")
    .select(CLUB_DEAL_COLUMNS)
    .in("venue_id", uniqueVenueIds)
    .eq("is_active", true)
    .eq("payout_type", "flat")
    .gt("payout_amount_cents", 0)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;

  const deals = new Map<string, ClubDeal[]>();
  for (const row of data || []) {
    const venueDeals = deals.get(row.venue_id) || [];
    venueDeals.push(toClubDeal(row));
    deals.set(row.venue_id, venueDeals);
  }
  return deals;
}

export async function getVerifiedActiveCheckInAtVenue(
  client: DancrClient,
  dancerId: string,
  venueId: string,
  now = new Date(),
) {
  if (!await dancerHasActiveVenueAffiliation(client, dancerId, venueId)) return null;
  const nowIso = now.toISOString();
  const { data, error } = await (client as any)
    .from("shifts")
    .select("id, location_status, checked_in_at, checked_out_at, location_verification_expires_at")
    .eq("dancer_id", dancerId)
    .eq("venue_id", venueId)
    .eq("status", "posted")
    .lte("starts_at", nowIso)
    .gte("ends_at", nowIso)
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .in("location_status", ["location_confirmed", "club_confirmed"])
    .limit(5);

  if (error) throw error;
  const verified = (data || []).find((shift: Record<string, unknown>) =>
    isCurrentLocationVerification(shift, now.getTime()),
  );
  return verified ? { shiftId: String(verified.id) } : null;
}

export async function dancerHasVerifiedActiveCheckInAtVenue(
  client: DancrClient,
  dancerId: string,
  venueId: string,
  now = new Date(),
) {
  return Boolean(await getVerifiedActiveCheckInAtVenue(client, dancerId, venueId, now));
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
      shift_id: input.sourceType === "dancer_profile" ? input.shiftId || null : null,
      attribution_locked_at: input.sourceType === "dancer_profile" ? new Date().toISOString() : null,
      customer_id: input.customerId || null,
      session_id: input.sessionId || null,
      nfc_tag_id: input.nfcTagId || null,
      expires_at: expiresAt,
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
      audit: {
        ...audit,
        campaign_source: input.campaignSource || null,
        deal_snapshot: issuedDealSnapshot(input),
      },
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
      shift_id,
      venue_id,
      generated_at,
      expires_at,
      redeemed_at,
      saved_at,
      shared_at,
      first_scanned_at,
      confirmed_at,
      redeemed_by_club_user,
      audit,
      venues(name, city, state),
      club_deals(id, deal_title, deal_description, deal_terms, is_active, payout_type, payout_amount_cents, currency, offer_type, booking_url)
    `,
    )
    .eq("redemption_token", token)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeScannerRedemption(data) : null;
}

export async function redeemDealToken(client: DancrClient, token: string, request: Request) {
  const audit = readRequestAudit(request);
  const { data, error } = await (client as any).rpc("confirm_deal_redemption", {
    p_token: token,
    p_audit: {
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      device_fingerprint: audit.deviceFingerprint,
    },
  });

  if (error) {
    const message = String(error.message || "Unable to redeem this Club Deal.");
    const status = message.includes("venue account") || message.includes("cannot redeem")
      ? 403
      : message.includes("not found")
        ? 404
        : message.includes("already")
          ? 409
          : 400;
    return { ok: false, status, error: message };
  }
  if (data?.ok === false) {
    return {
      ok: false,
      status: Number(data.status || 400),
      error: String(data.error || "Unable to redeem this Club Deal."),
    };
  }

  return {
    ok: true,
    status: 200,
    confirmation: data,
    redemption: await getRedemptionForScanner(client, token),
  };
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

export async function getDancerDealMetrics(client: DancrClient, userId: string) {
  const db = client as any;
  const { data: profile, error: profileError } = await db
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const [
    { data: redemptions, error: redemptionError },
    { data: commissions, error: commissionError },
    { data: lifecycle, error: lifecycleError },
  ] = await Promise.all([
    db
      .from("qr_redemptions")
      .select("id, status, source_type, generated_at, redeemed_at, club_deals(deal_title), venues(name)")
      .eq("dancer_id", profile.id)
      .eq("source_type", "dancer_profile")
      .order("generated_at", { ascending: false })
      .limit(100),
    db
      .from("commission_events")
      .select(
        "id, status, amount_cents, payout_type, gross_commission_cents, dancer_share_bps, platform_amount_cents, successful_redemption_number, commission_month, policy_version, created_at, club_deals(deal_title), venues(name)",
      )
      .eq("dancer_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("qr_redemption_events")
      .select("event_type, qr_redemptions!inner(dancer_id, source_type)")
      .eq("qr_redemptions.dancer_id", profile.id)
      .eq("qr_redemptions.source_type", "dancer_profile")
      .limit(500),
  ]);

  if (redemptionError) throw redemptionError;
  if (commissionError) throw commissionError;
  if (lifecycleError) throw lifecycleError;

  const commissionTotal = (statuses: string[]) =>
    (commissions || [])
      .filter((item: any) => statuses.includes(item.status))
      .reduce((sum: number, item: any) => sum + Number(item.amount_cents || 0), 0);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentMonthCommissions = (commissions || []).filter(
    (item: any) => String(item.commission_month || "").slice(0, 7) === currentMonth
      && !["rejected", "voided"].includes(item.status),
  );
  const successfulRedemptionsThisMonth = currentMonthCommissions.reduce(
    (highest: number, item: any) => Math.max(highest, Number(item.successful_redemption_number || 0)),
    0,
  );
  const currentDancerSharePercent = successfulRedemptionsThisMonth >= 75
    ? 50
    : successfulRedemptionsThisMonth >= 25
      ? 40
      : 30;
  const nextTierAt = successfulRedemptionsThisMonth < 25
    ? 25
    : successfulRedemptionsThisMonth < 75
      ? 75
      : null;

  return {
    tokensGenerated: redemptions?.length || 0,
    qrOpens: (lifecycle || []).filter((item: any) => item.event_type === "scanner_opened").length,
    qrSaves: (lifecycle || []).filter((item: any) => item.event_type === "saved").length,
    qrShares: (lifecycle || []).filter((item: any) => item.event_type === "shared").length,
    redeemed: (redemptions || []).filter((item: any) => item.status === "redeemed").length,
    expiredOrVoided: (redemptions || []).filter((item: any) => item.status === "expired" || item.status === "voided").length,
    pendingCommissions: 0,
    payableCommissions: (commissions || []).filter((item: any) => item.status === "payable").length,
    paidCommissions: (commissions || []).filter((item: any) => item.status === "paid").length,
    rejectedCommissions: (commissions || []).filter((item: any) => item.status === "rejected" || item.status === "voided").length,
    pendingCommissionCents: 0,
    payableCommissionCents: commissionTotal(["payable"]),
    paidCommissionCents: commissionTotal(["paid"]),
    earnedCommissionCents: commissionTotal(["payable", "paid"]),
    totalCommissionCents: commissionTotal(["payable", "paid"]),
    successfulRedemptionsThisMonth,
    currentDancerSharePercent,
    nextTierAt,
    redemptionsUntilNextTier: nextTierAt === null ? 0 : Math.max(0, nextTierAt - successfulRedemptionsThisMonth),
    commissionPolicyVersion: "monthly-tier-v1",
    recentRedemptions: redemptions || [],
    recentCommissions: commissions || [],
  };
}

export async function getCustomerDealRedemptions(client: DancrClient, customerId: string) {
  const { data, error } = await (client as any)
    .from("qr_redemptions")
    .select(
      "id, redemption_token, source_type, status, generated_at, expires_at, redeemed_at, audit, venues(name, slug), club_deals(deal_title, deal_terms)",
    )
    .eq("customer_id", customerId)
    .order("generated_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data || []).map((row: any) => {
    const venue = readJoinedFirst(row.venues);
    const deal = readJoinedFirst(row.club_deals);
    const dealSnapshot = readIssuedDealSnapshot(row.audit);
    return {
      id: row.id,
      redemptionToken: row.redemption_token,
      sourceType: row.source_type,
      status: row.status,
      generatedAt: row.generated_at,
      expiresAt: row.expires_at,
      redeemedAt: row.redeemed_at,
      venue: venue
        ? { name: String(venue.name || "Venue"), slug: String(venue.slug || "") }
        : null,
      deal: deal
        ? {
            title: String(dealSnapshot ? dealSnapshot.dealTitle : deal.deal_title || "Club Deal"),
            terms: dealSnapshot
              ? dealSnapshot.dealTerms
              : deal.deal_terms ? String(deal.deal_terms) : null,
          }
        : null,
    };
  }).filter((item: any) => item.venue && item.deal);
}

export async function getVenueDealForAccount(client: DancrClient, userId: string) {
  const owned = await getVenueDealsForAccount(client, userId);
  if (!owned) return null;
  return { venueId: owned.venueId, deal: owned.deals[0] || null };
}

export async function getVenueDealsForAccount(
  client: DancrClient,
  userId: string,
): Promise<{ venueId: string; deals: ClubDeal[] } | null> {
  const db = client as any;
  const access = await requireVenueAccess(client, userId, "view_deals");

  const { data: deals, error: dealError } = await db
    .from("club_deals")
    .select(CLUB_DEAL_COLUMNS)
    .eq("venue_id", access.venueId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (dealError) throw dealError;

  return {
    venueId: access.venueId,
    deals: (deals || []).map(toClubDeal),
  };
}

export async function updateVenueDealForAccount(
  client: DancrClient,
  userId: string,
  input: VenueDealInput,
) {
  const db = client as any;
  await requireVenueAccess(client, userId, "manage_deals");
  const owned = await getVenueDealsForAccount(client, userId);
  if (!owned) throw new Error("Venue profile not found.");

  const dealTitle = requiredDealText(input.dealTitle, "Deal title", 3, 100);
  const dealDescription = requiredDealText(input.dealDescription, "Deal description", 8, 500);
  const dealTerms = optionalDealText(input.dealTerms, "Deal terms", 1200);
  const offerType = normalizeOfferType(input.offerType);
  const bookingUrl = optionalBookingUrl(input.bookingUrl);
  if (offerType === "bottle_service" && input.isActive && !bookingUrl) {
    throw new Error("A live HTTPS booking URL is required before publishing bottle service.");
  }
  const sortOrder = Math.trunc(Number(input.sortOrder || 0));
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) {
    throw new Error("Offer order must be between 0 and 1000.");
  }
  const referralCommissionCents = Math.trunc(Number(input.referralCommissionCents));
  if (!Number.isSafeInteger(referralCommissionCents) || referralCommissionCents < 100 || referralCommissionCents > 100_000) {
    throw new Error("Referral commission must be between $1.00 and $1,000.00 per successful redemption.");
  }

  const row = {
    venue_id: owned.venueId,
    deal_title: dealTitle,
    deal_description: dealDescription,
    deal_terms: dealTerms,
    is_active: Boolean(input.isActive),
    redemption_rules: {
      one_per_guest: true,
      authenticated_venue_confirmation_required: true,
      attribution_policy: "locked_at_issue",
      commission_policy: "monthly-tier-v1",
    },
    payout_type: "flat",
    payout_amount_cents: referralCommissionCents,
    currency: "usd",
    offer_type: offerType,
    booking_url: bookingUrl,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };

  const existingDeal = input.dealId
    ? owned.deals.find((deal) => deal.id === input.dealId)
    : null;
  if (input.dealId && !existingDeal) throw new Error("Club Deal not found for this venue.");
  if (existingDeal) await snapshotIssuedDealPassesBeforeUpdate(db, existingDeal);
  const query = existingDeal
    ? db.from("club_deals").update(row).eq("id", existingDeal.id).eq("venue_id", owned.venueId)
    : db.from("club_deals").insert(row);
  const { data, error } = await query
    .select(CLUB_DEAL_COLUMNS)
    .single();
  if (error) throw error;

  const deal = toClubDeal(data);
  const deals = [deal, ...owned.deals.filter((candidate) => candidate.id !== deal.id)]
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return { deal, deals };
}

export async function deleteVenueDealForAccount(
  client: DancrClient,
  userId: string,
  dealId: string,
) {
  await requireVenueAccess(client, userId, "manage_deals");
  const owned = await getVenueDealsForAccount(client, userId);
  if (!owned || !owned.deals.some((deal) => deal.id === dealId)) {
    throw new Error("Club Deal not found for this venue.");
  }
  const { error } = await (client as any)
    .from("club_deals")
    .delete()
    .eq("id", dealId)
    .eq("venue_id", owned.venueId);
  if (error) throw error;
  return { id: dealId };
}

export async function getVenueDealRevenueMetrics(client: DancrClient, venueId: string) {
  const db = client as any;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    { data: revenue, error: revenueError },
    { data: lifecycle, error: lifecycleError },
    { data: issuedPasses, error: issuedPassesError },
  ] = await Promise.all([
    db
      .from("deal_revenue_events")
      .select(
        "id, source_type, status, gross_commission_cents, confirmed_at",
      )
      .eq("venue_id", venueId)
      .gte("confirmed_at", monthStart.toISOString())
      .order("confirmed_at", { ascending: false })
      .limit(500),
    db
      .from("qr_redemption_events")
      .select("event_type, qr_redemptions!inner(venue_id)")
      .eq("qr_redemptions.venue_id", venueId)
      .gte("occurred_at", monthStart.toISOString())
      .limit(1000),
    db
      .from("qr_redemptions")
      .select("id, source_type, audit")
      .eq("venue_id", venueId)
      .gte("generated_at", monthStart.toISOString())
      .limit(1000),
  ]);
  if (revenueError) throw revenueError;
  if (lifecycleError) throw lifecycleError;
  if (issuedPassesError) throw issuedPassesError;

  const rows = revenue || [];
  const activeRows = rows.filter((item: any) => !["refunded", "voided"].includes(item.status));
  const sum = (column: string, selected = activeRows) =>
    selected.reduce((total: number, item: any) => total + Number(item[column] || 0), 0);
  const countLifecycle = (eventType: string) =>
    (lifecycle || []).filter((item: any) => item.event_type === eventType).length;

  return {
    successfulRedemptionsThisMonth: activeRows.length,
    dancerAttributedRedemptionsThisMonth: activeRows.filter((item: any) => item.source_type === "dancer_profile").length,
    directVenueRedemptionsThisMonth: activeRows.filter((item: any) => item.source_type === "club_page").length,
    myDancrFeesCentsThisMonth: sum("gross_commission_cents"),
    pendingVenuePaymentCents: sum(
      "gross_commission_cents",
      rows.filter((item: any) => item.status === "pending_venue_payment"),
    ),
    postedVenueQrScansThisMonth: (issuedPasses || []).filter(
      (item: any) => item.source_type === "club_page" && item.audit?.campaign_source === "venue_qr",
    ).length,
    passesIssuedThisMonth: (issuedPasses || []).length,
    savesThisMonth: countLifecycle("saved"),
    sharesThisMonth: countLifecycle("shared"),
    scannerOpensThisMonth: countLifecycle("scanner_opened"),
  };
}

export async function settleDealRevenueEvent(
  client: DancrClient,
  revenueEventId: string,
  action: "venue_payment_received",
  externalReference: string,
) {
  const { data, error } = await (client as any).rpc("settle_deal_revenue_event", {
    p_revenue_event_id: revenueEventId,
    p_action: action,
    p_external_reference: externalReference,
  });
  if (error) throw error;
  return data;
}

export async function settleDancerCommissionEvent(
  client: DancrClient,
  commissionEventId: string,
  externalReference: string,
) {
  const { data, error } = await (client as any).rpc("settle_dancer_commission_event", {
    p_commission_event_id: commissionEventId,
    p_external_reference: externalReference,
  });
  if (error) throw error;
  return data;
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
      commission_events(id, status, amount_cents, dancer_share_bps, gross_commission_cents, platform_amount_cents, payable_at, paid_at, audit),
      deal_revenue_events(id, status, gross_commission_cents, venue_payment_reference, venue_payment_received_at)
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

export async function voidDealRedemption(client: DancrClient, redemptionId: string) {
  const { data, error } = await (client as any).rpc("void_generated_deal_redemption", {
    p_redemption_id: redemptionId,
    p_reason: "admin_marked_suspicious",
  });
  if (error) throw error;
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
    currency: row.currency || "usd",
    offerType: normalizeOfferType(row.offer_type),
    bookingUrl: row.booking_url || null,
    sortOrder: Number(row.sort_order || 0),
  };
}

function normalizeOfferType(value: unknown): ClubDealOfferType {
  return value === "drink" || value === "bottle_service" || value === "other"
    ? value
    : "admission";
}

function optionalBookingUrl(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > 1000) throw new Error("Booking URL must be 1000 characters or fewer.");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Booking URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Booking URL must use HTTPS.");
  return parsed.toString();
}

function requiredDealText(value: string, label: string, minimum: number, maximum: number) {
  const text = String(value || "").trim();
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} must be ${minimum} to ${maximum} characters.`);
  }
  if (/[<>]/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

function optionalDealText(value: string | null | undefined, label: string, maximum: number) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  if (/[<>]/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

function normalizeScannerRedemption(row: any) {
  const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
  const deal = Array.isArray(row.club_deals) ? row.club_deals[0] : row.club_deals;
  const dealSnapshot = readIssuedDealSnapshot(row.audit);

  return {
    id: row.id,
    redemptionToken: row.redemption_token,
    status: row.status,
    sourceType: row.source_type,
    dancerId: row.dancer_id,
    shiftId: row.shift_id,
    venueId: row.venue_id,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    savedAt: row.saved_at,
    sharedAt: row.shared_at,
    firstScannedAt: row.first_scanned_at,
    confirmedAt: row.confirmed_at,
    redeemedByClubUser: row.redeemed_by_club_user,
    venue: venue ? { name: venue.name, city: venue.city, state: venue.state } : null,
    deal: deal
      ? {
          id: deal.id,
          dealTitle: dealSnapshot ? dealSnapshot.dealTitle : deal.deal_title,
          dealDescription: dealSnapshot ? dealSnapshot.dealDescription : deal.deal_description,
          dealTerms: dealSnapshot ? dealSnapshot.dealTerms : deal.deal_terms,
          offerType: dealSnapshot ? dealSnapshot.offerType : deal.offer_type || "admission",
          bookingUrl: dealSnapshot ? dealSnapshot.bookingUrl : deal.booking_url ?? null,
          isActive: deal.is_active,
          referralCommissionCents: Number(deal.payout_amount_cents || 0),
          currency: String(deal.currency || "usd"),
        }
      : null,
    audit: row.audit || {},
  };
}

function issuedDealSnapshot(input: Pick<DealRedemptionInput, "dealTitle" | "dealDescription" | "dealTerms" | "dealOfferType" | "dealBookingUrl">) {
  return {
    dealTitle: input.dealTitle,
    dealDescription: input.dealDescription,
    dealTerms: input.dealTerms || null,
    offerType: input.dealOfferType,
    bookingUrl: input.dealBookingUrl || null,
  };
}

function readIssuedDealSnapshot(audit: unknown) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return null;
  const snapshot = (audit as Record<string, unknown>).deal_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  if (typeof value.dealTitle !== "string" || typeof value.dealDescription !== "string") return null;
  return {
    dealTitle: value.dealTitle,
    dealDescription: value.dealDescription,
    dealTerms: typeof value.dealTerms === "string" ? value.dealTerms : null,
    offerType: normalizeOfferType(String(value.offerType || "admission")),
    bookingUrl: typeof value.bookingUrl === "string" ? value.bookingUrl : null,
  };
}

async function snapshotIssuedDealPassesBeforeUpdate(db: any, deal: ClubDeal) {
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from("qr_redemptions")
      .select("id, audit")
      .eq("club_deal_id", deal.id)
      .eq("status", "generated")
      .gt("expires_at", new Date().toISOString())
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const rows = data || [];
    const unsnapshotted = rows.filter((row: any) => !readIssuedDealSnapshot(row.audit));
    const snapshot = {
      dealTitle: deal.dealTitle,
      dealDescription: deal.dealDescription,
      dealTerms: deal.dealTerms,
      offerType: deal.offerType,
      bookingUrl: deal.bookingUrl,
    };
    for (let index = 0; index < unsnapshotted.length; index += 25) {
      const batch = unsnapshotted.slice(index, index + 25);
      const results = await Promise.all(batch.map((row: any) => db
        .from("qr_redemptions")
        .update({ audit: { ...(row.audit || {}), deal_snapshot: snapshot } })
        .eq("id", row.id)
        .eq("status", "generated")));
      const failed = results.find((result: any) => result.error);
      if (failed?.error) throw failed.error;
    }

    if (rows.length < pageSize) break;
    offset += rows.length;
  }
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
