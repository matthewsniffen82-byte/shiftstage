import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { isActiveNfcPresence } from "./shift-presence";

type DancrClient = SupabaseClient;

type QueryWarning = {
  section: string;
  message: string;
};

type CountResult = {
  count: number;
  warning?: QueryWarning;
};

type RevenueSummary = {
  grossCommissionCents: number;
  platformCommissionCents: number;
  dancerCommissionCents: number;
  pendingVenuePaymentCents: number;
  payableCents: number;
  settledCents: number;
};

export type AdminOperationsCenter = {
  checkedAt: string;
  attention: {
    dancerProfiles: number;
    photos: number;
    videos: number;
    socialLinks: number;
    reports: number;
    dmca: number;
    support: number;
    venues: number;
    overdue: number;
    total: number;
  };
  live: {
    checkedInDancers: Array<Record<string, unknown>>;
    activeVenueCount: number;
    qrGeneratedToday: number;
    qrRedeemedToday: number;
    suspiciousQrToday: number;
    missedCheckIns: Array<Record<string, unknown>>;
  };
  revenue: {
    grossCommissionCents: number;
    platformCommissionCents: number;
    dancerCommissionCents: number;
    pendingVenuePaymentCents: number;
    payableCents: number;
    settledCents: number;
    conversionRate: number;
    recent: Array<Record<string, unknown>>;
  };
  analytics: {
    totalAccounts: number;
    activeDancers: number;
    newAccounts7d: number;
    profileViews7d: number;
    profileViews30d: number;
    directionRequests7d: number;
    newFollows7d: number;
    publishedVideos30d: number;
  };
  activity: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  warnings: QueryWarning[];
};

export async function getAdminOperationsCenter(client: DancrClient): Promise<AdminOperationsCenter> {
  const db = client as any;
  const now = new Date();
  const checkedAt = now.toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const results = await Promise.all([
    safeCount("Dancer approvals", () => db.from("dancer_profiles").select("id", { count: "exact", head: true }).eq("status", "pending_review")),
    safeCount("Photo moderation", () => db.from("image_moderation_records").select("id", { count: "exact", head: true }).eq("decision", "review")),
    safeCount("Video moderation", () => db.from("mydancr_tv_videos").select("id", { count: "exact", head: true }).eq("status", "submitted")),
    safeCount("Social link reviews", () => db.from("approval_reviews").select("id", { count: "exact", head: true }).eq("status", "pending").like("review_type", "social_link:%")),
    safeCount("Content reports", () => db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "open")),
    safeCount("Copyright cases", () => db.from("dmca_cases").select("id", { count: "exact", head: true }).in("status", ["submitted", "information_requested", "countered"])),
    safeCount("Support inbox", () => db.from("support_threads").select("id", { count: "exact", head: true }).eq("status", "open")),
    safeCount("Venue setup", () => db.from("venues").select("id", { count: "exact", head: true }).eq("is_active", false)),
    safeCount("Overdue dancer approvals", () => db.from("dancer_profiles").select("id", { count: "exact", head: true }).eq("status", "pending_review").lt("updated_at", dayAgo)),
    safeCount("Overdue support", () => db.from("support_threads").select("id", { count: "exact", head: true }).eq("status", "open").lt("last_message_at", dayAgo)),
    safeCount("Overdue reports", () => db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "open").lt("created_at", dayAgo)),
    safeCount("Overdue video moderation", () => db.from("mydancr_tv_videos").select("id", { count: "exact", head: true }).eq("status", "submitted").lt("submitted_at", dayAgo)),
    safeRows("Checked-in dancers", () => db.from("shifts")
      .select("id, status, shift_date, shift_source, starts_at, ends_at, checked_in_at, checked_out_at, location_status, location_verification_expires_at, dancer_profiles(id, stage_name, slug, city), venues(id, name, slug, city)")
      .not("checked_in_at", "is", null)
      .is("checked_out_at", null)
      .eq("location_status", "club_confirmed")
      .gt("location_verification_expires_at", checkedAt)
      .order("checked_in_at", { ascending: false })
      .limit(30)),
    safeCount("Active venues", () => db.from("venues").select("id", { count: "exact", head: true }).eq("is_active", true)),
    safeCount("Club Deal intents created today", () => db.from("qr_redemptions").select("id", { count: "exact", head: true }).gte("generated_at", dayAgo)),
    safeCount("Cashier tap redemptions today", () => db.from("qr_redemptions").select("id", { count: "exact", head: true }).eq("status", "redeemed").gte("redeemed_at", dayAgo)),
    safeCount("Suspicious Club Deal activity", () => db.from("qr_redemptions").select("id", { count: "exact", head: true }).eq("suspicious", true).gte("generated_at", dayAgo)),
    safeRows("Missed check-ins", () => db.from("shifts")
      .select("id, shift_date, shift_source, starts_at, ends_at, location_status, dancer_profiles(id, stage_name, slug, city), venues(id, name, slug, city)")
      .eq("status", "posted")
      .is("checked_in_at", null)
      .eq("shift_source", "scheduled")
      .lt("shift_date", checkedAt.slice(0, 10))
      .order("starts_at", { ascending: true })
      .limit(20)),
    safeRows("Revenue health", () => db.from("deal_revenue_events")
      .select("id, status, source_type, currency, gross_commission_cents, dancer_commission_cents, platform_commission_cents, venue_payment_received_at, dancer_paid_at, created_at, venues(id, name, slug), club_deals(id, title), dancer_profiles(id, stage_name, slug)")
      .order("created_at", { ascending: false })
      .limit(100)),
    safeRows("Dancer payout health", () => db.from("commission_events")
      .select("id, status, amount_cents, paid_at, created_at")
      .order("created_at", { ascending: false })
      .limit(1000)),
    safeCount("Accounts", () => db.from("app_users").select("id", { count: "exact", head: true }).neq("account_state", "deleted")),
    safeCount("Active dancers", () => db.from("dancer_profiles").select("id", { count: "exact", head: true }).eq("status", "approved")),
    safeCount("New accounts", () => db.from("app_users").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo)),
    safeCount("Profile views (7 days)", () => db.from("profile_views").select("id", { count: "exact", head: true }).gte("viewed_at", sevenDaysAgo)),
    safeCount("Profile views (30 days)", () => db.from("profile_views").select("id", { count: "exact", head: true }).gte("viewed_at", thirtyDaysAgo)),
    safeCount("Direction requests", () => db.from("direction_requests").select("id", { count: "exact", head: true }).gte("requested_at", sevenDaysAgo)),
    safeCount("New follows", () => db.from("follows").select("dancer_id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo)),
    safeCount("Published videos", () => db.from("mydancr_tv_videos").select("id", { count: "exact", head: true }).eq("status", "approved").gte("published_at", thirtyDaysAgo)),
    safeRows("Admin activity", () => db.from("admin_actions")
      .select("id, admin_id, target_type, target_id, action, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(60)),
    safeRows("Recent accounts", () => db.from("app_users")
      .select("id, role, display_name, email, account_state, created_at, updated_at, dancer_profiles(id, stage_name, slug, city, status)")
      .order("created_at", { ascending: false })
      .limit(60)),
  ]);

  const [
    dancerProfiles, photos, videos, socialLinks, reports, dmca, support, venues,
    overdueProfiles, overdueSupport, overdueReports, overdueVideos,
    checkedInDancers, activeVenueCount, qrGeneratedToday, qrRedeemedToday, suspiciousQrToday,
    missedCheckIns, revenueRows, commissionRows, totalAccounts, activeDancers, newAccounts7d, profileViews7d,
    profileViews30d, directionRequests7d, newFollows7d, publishedVideos30d, activity, accounts,
  ] = results;

  const revenue = summarizeRevenue(revenueRows.rows || [], commissionRows.rows || []);
  const overdue = count(overdueProfiles) + count(overdueSupport) + count(overdueReports) + count(overdueVideos);
  const attentionCounts = {
    dancerProfiles: count(dancerProfiles),
    photos: count(photos),
    videos: count(videos),
    socialLinks: count(socialLinks),
    reports: count(reports),
    dmca: count(dmca),
    support: count(support),
    venues: count(venues),
  };
  const warnings = results.flatMap((result) => result.warning ? [result.warning] : []);

  return {
    checkedAt,
    attention: {
      ...attentionCounts,
      overdue,
      total: Object.values(attentionCounts).reduce((sum, value) => sum + value, 0),
    },
    live: {
      checkedInDancers: (checkedInDancers.rows || []).filter((shift) =>
        isActiveNfcPresence(shift, now.getTime()),
      ),
      activeVenueCount: count(activeVenueCount),
      qrGeneratedToday: count(qrGeneratedToday),
      qrRedeemedToday: count(qrRedeemedToday),
      suspiciousQrToday: count(suspiciousQrToday),
      missedCheckIns: missedCheckIns.rows || [],
    },
    revenue: {
      ...revenue,
      conversionRate: count(qrGeneratedToday) > 0
        ? Math.round((count(qrRedeemedToday) / count(qrGeneratedToday)) * 1000) / 10
        : 0,
      recent: (revenueRows.rows || []).slice(0, 12),
    },
    analytics: {
      totalAccounts: count(totalAccounts),
      activeDancers: count(activeDancers),
      newAccounts7d: count(newAccounts7d),
      profileViews7d: count(profileViews7d),
      profileViews30d: count(profileViews30d),
      directionRequests7d: count(directionRequests7d),
      newFollows7d: count(newFollows7d),
      publishedVideos30d: count(publishedVideos30d),
    },
    activity: activity.rows || [],
    accounts: accounts.rows || [],
    warnings,
  };
}

async function safeCount(section: string, query: () => PromiseLike<any>): Promise<CountResult> {
  try {
    const result = await query();
    if (result.error) throw result.error;
    return { count: Number(result.count || 0) };
  } catch (error) {
    logOperationalQueryFailure(section, error);
    return { count: 0, warning: { section, message: operationalWarningMessage() } };
  }
}

async function safeRows(section: string, query: () => PromiseLike<any>): Promise<{ rows: Array<Record<string, unknown>>; warning?: QueryWarning }> {
  try {
    const result = await query();
    if (result.error) throw result.error;
    return { rows: Array.isArray(result.data) ? result.data : [] };
  } catch (error) {
    logOperationalQueryFailure(section, error);
    return { rows: [], warning: { section, message: operationalWarningMessage() } };
  }
}

function count(result: { count?: number }) {
  return Number(result.count || 0);
}

function summarizeRevenue(
  rows: Array<Record<string, unknown>>,
  commissions: Array<Record<string, unknown>>,
): RevenueSummary {
  const summary = rows.reduce<RevenueSummary>((current, row) => {
    const gross = Number(row.gross_commission_cents || 0);
    const dancer = Number(row.dancer_commission_cents || 0);
    const platform = Number(row.platform_commission_cents || 0);
    current.grossCommissionCents += gross;
    current.dancerCommissionCents += dancer;
    current.platformCommissionCents += platform;
    if (row.status === "pending_venue_payment") current.pendingVenuePaymentCents += gross;
    if (row.status === "settled") current.settledCents += gross;
    return current;
  }, {
    grossCommissionCents: 0,
    platformCommissionCents: 0,
    dancerCommissionCents: 0,
    pendingVenuePaymentCents: 0,
    payableCents: 0,
    settledCents: 0,
  });
  summary.payableCents = commissions
    .filter((row) => row.status === "available")
    .reduce((total, row) => total + Number(row.amount_cents || 0), 0);
  return summary;
}

function logOperationalQueryFailure(section: string, error: unknown) {
  console.warn("ADMIN_OPERATIONS_QUERY_FAILED", {
    section,
    ...safeErrorMetadata(error),
  });
}

function operationalWarningMessage() {
  return "Unable to query this operational dataset.";
}
