import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClubDeal, ClubDealOfferType } from "./types";
import { isActiveNfcPresence } from "./shift-presence";
import { dancerHasActiveVenueAffiliation } from "./venue-affiliations";
import { requireVenueAccess } from "./venue-access";
import { isLiquorRelatedClubDeal } from "./deal-policy";
import {
  commissionTierForSuccessfulRedemption,
  QR_COMMISSION_POLICY_VERSION,
} from "./commission-policy";

type DancrClient = SupabaseClient;

export const CLUB_DEAL_COLUMNS =
  "id, venue_id, deal_title, deal_description, deal_terms, is_active, valid_days, valid_start_time, valid_end_time, redemption_rules, payout_type, payout_amount_cents, currency, offer_type, booking_url, sort_order, created_at";

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
  return (data || []).filter(isAllowedClubDealRow).map(toClubDeal);
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
  return data && isAllowedClubDealRow(data) ? toClubDeal(data) : null;
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
  return data && isAllowedClubDealRow(data) ? toClubDeal(data) : null;
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
  for (const row of (data || []).filter(isAllowedClubDealRow)) {
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
    .select("id, shift_source, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at")
    .eq("dancer_id", dancerId)
    .eq("venue_id", venueId)
    .eq("status", "posted")
    .not("checked_in_at", "is", null)
    .is("checked_out_at", null)
    .eq("location_status", "club_confirmed")
    .neq("shift_source", "demo_locked")
    .gt("location_verification_expires_at", nowIso)
    .limit(5);

  if (error) throw error;
  const verified = (data || []).find((shift: Record<string, unknown>) =>
    isActiveNfcPresence(shift, now.getTime()),
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
      && item.status !== "reversed",
  );
  const successfulRedemptionsThisMonth = currentMonthCommissions.reduce(
    (highest: number, item: any) => Math.max(highest, Number(item.successful_redemption_number || 0)),
    0,
  );
  const currentDancerSharePercent =
    commissionTierForSuccessfulRedemption(successfulRedemptionsThisMonth).dancerShareBps / 100;
  const nextTierAt = successfulRedemptionsThisMonth < 10
    ? 10
    : successfulRedemptionsThisMonth < 25
      ? 25
      : null;

  return {
    tokensGenerated: redemptions?.length || 0,
    qrOpens: (lifecycle || []).filter((item: any) => item.event_type === "scanner_opened").length,
    qrSaves: (lifecycle || []).filter((item: any) => item.event_type === "saved").length,
    qrShares: (lifecycle || []).filter((item: any) => item.event_type === "shared").length,
    redeemed: (redemptions || []).filter((item: any) => item.status === "redeemed").length,
    expiredOrVoided: (redemptions || []).filter((item: any) => item.status === "expired" || item.status === "voided").length,
    pendingCommissions: (commissions || []).filter((item: any) => item.status === "pending").length,
    payableCommissions: (commissions || []).filter((item: any) => item.status === "available").length,
    paidCommissions: (commissions || []).filter((item: any) => item.status === "paid").length,
    rejectedCommissions: (commissions || []).filter((item: any) => item.status === "reversed").length,
    pendingCommissionCents: commissionTotal(["pending"]),
    payableCommissionCents: commissionTotal(["available"]),
    paidCommissionCents: commissionTotal(["paid"]),
    earnedCommissionCents: commissionTotal(["available", "payout_processing", "paid"]),
    totalCommissionCents: commissionTotal(["pending", "available", "payout_processing", "paid"]),
    successfulRedemptionsThisMonth,
    currentDancerSharePercent,
    nextTierAt,
    redemptionsUntilNextTier: nextTierAt === null ? 0 : Math.max(0, nextTierAt - successfulRedemptionsThisMonth),
    commissionPolicyVersion: QR_COMMISSION_POLICY_VERSION,
    recentRedemptions: redemptions || [],
    recentCommissions: commissions || [],
  };
}

export async function getCustomerDealRedemptions(client: DancrClient, customerId: string) {
  const { data, error } = await (client as any)
    .from("qr_redemptions")
    .select(
      "id, redemption_token, source_type, status, generated_at, expires_at, redeemed_at, audit, venues(id, name, slug), club_deals(deal_title, deal_terms)",
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
        ? { id: String(venue.id || ""), name: String(venue.name || "Venue"), slug: String(venue.slug || "") }
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
    deals: (deals || []).filter(isAllowedClubDealRow).map(toClubDeal),
  };
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
      .select("id")
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
    confirmedCashierTapsThisMonth: activeRows.length,
    dancerAttributedRedemptionsThisMonth: activeRows.filter((item: any) => item.source_type === "dancer_profile").length,
    directVenueRedemptionsThisMonth: activeRows.filter((item: any) => item.source_type === "club_page").length,
    myDancrFeesCentsThisMonth: sum("gross_commission_cents"),
    pendingVenuePaymentCents: sum(
      "gross_commission_cents",
      rows.filter((item: any) => item.status === "pending_venue_payment"),
    ),
    passesIssuedThisMonth: (issuedPasses || []).length,
    savesThisMonth: countLifecycle("saved"),
    sharesThisMonth: countLifecycle("shared"),
    scannerOpensThisMonth: countLifecycle("scanner_opened"),
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

export function toClubDeal(row: any): ClubDeal {
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
  return value === "other" ? "other" : "admission";
}

function isAllowedClubDealRow(row: any) {
  return !isLiquorRelatedClubDeal({
    offerType: row?.offer_type,
    dealTitle: row?.deal_title,
    dealDescription: row?.deal_description,
    dealTerms: row?.deal_terms,
  });
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

export function readIssuedDealSnapshot(audit: unknown) {
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

function readJoinedFirst(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) || null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}
