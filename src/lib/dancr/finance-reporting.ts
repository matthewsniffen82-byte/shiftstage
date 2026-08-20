import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPayoutRuntimeConfig,
  isPayoutProviderConfigured,
  type PayoutProviderName,
} from "./payout-provider";
import {
  getDancerForUser,
  getEffectivePayoutSettings,
} from "./payout-account-store";
import { requireVenueAccess } from "./venue-access";
import { getNatsRuntimeConfig } from "./nats";

type DancrClient = SupabaseClient;

const MAX_FINANCE_ROWS = 5_000;

export async function getAdminFinanceOverview(client: DancrClient) {
  const now = new Date().toISOString();
  const [invoicesResult, payoutsResult, revenueResult, commissionsResult, settingsResult, auditResult, dancerFinancialSummaryResult, natsAccountsResult, natsExportsResult] = await Promise.all([
    (client as any).from("club_invoices")
      .select("id, venue_id, period_start, period_end, sequence, status, currency, amount_due_cents, amount_paid_cents, due_at, hosted_invoice_url, invoice_pdf_url, external_payment_reference, paid_at, reminder_count, last_error, venues(name)")
      .order("created_at", { ascending: false }).limit(200),
    (client as any).from("dancer_payout_batches")
      .select("id, dancer_id, status, currency, amount_cents, payment_provider, provider_reference_id, failure_message, requested_at, processing_at, paid_at, failed_at, is_test, created_at, dancer_profiles(stage_name)")
      .order("created_at", { ascending: false }).limit(200),
    (client as any).from("deal_revenue_events")
      .select("status, gross_commission_cents, dancer_commission_cents, platform_commission_cents").limit(MAX_FINANCE_ROWS),
    (client as any).from("commission_events")
      .select("id, qr_redemption_id, dancer_id, venue_id, club_deal_id, earning_type, status, amount_cents, currency, created_at, pending_until, available_at, held_at, hold_reason, review_flag, reversal_reason, is_test, dancer_profiles(stage_name), venues(name), club_deals(deal_title)")
      .order("created_at", { ascending: false }).limit(MAX_FINANCE_ROWS),
    (client as any).from("payout_settings").select("*").eq("id", "default").single(),
    (client as any).from("financial_audit_events").select("id, actor_type, action, target_type, target_id, reason, created_at")
      .order("created_at", { ascending: false }).limit(100),
    (client as any).rpc("get_admin_dancer_financial_summary"),
    (client as any).from("nats_affiliate_accounts")
      .select("dancer_id, login_id, username, status, requested_at, activated_at, disabled_at, verification_note, last_error, dancer_profiles(stage_name)")
      .order("requested_at", { ascending: false }).limit(500),
    (client as any).from("nats_commission_exports")
      .select("id, commission_event_id, dancer_id, amount_cents, currency, status, attempt_count, processing_started_at, exported_at, failed_at, reconciled_at, nats_result, last_error, created_at, dancer_profiles(stage_name)")
      .order("created_at", { ascending: false }).limit(500),
  ]);
  for (const result of [invoicesResult, payoutsResult, revenueResult, commissionsResult, settingsResult, auditResult, dancerFinancialSummaryResult, natsAccountsResult, natsExportsResult]) {
    if (result.error) throw result.error;
  }
  const invoices = invoicesResult.data || [];
  const payouts = payoutsResult.data || [];
  const revenue = revenueResult.data || [];
  const commissions = commissionsResult.data || [];
  const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const outstanding = invoices.filter((row: any) => ["open", "overdue"].includes(row.status));
  const overdue = outstanding.filter((row: any) => row.status === "overdue" || row.due_at < now);
  const paidInvoices = invoices.filter((row: any) => row.status === "paid");
  const dancerFinancialSummary = dancerFinancialSummaryResult.data || {};
  const earningGroup = (relationship: string, fallback: string) => Array.from(commissions.reduce((groups: Map<string, { name: string; amountCents: number; count: number }>, row: any) => {
    if (["reversed", "failed"].includes(String(row.status))) return groups;
    const related = joined(row[relationship]);
    const name = String(related?.stage_name || related?.name || fallback);
    const current = groups.get(name) || { name, amountCents: 0, count: 0 };
    current.amountCents += Number(row.amount_cents || 0);
    current.count += 1;
    groups.set(name, current);
    return groups;
  }, new Map()).values()).sort((a: any, b: any) => b.amountCents - a.amountCents);
  const configuredProvider = String(settingsResult.data?.payment_provider || "stripe") as PayoutProviderName;
  const providerConfigured = isPayoutProviderConfigured(configuredProvider);
  const natsConfig = getNatsRuntimeConfig();
  const natsExports = natsExportsResult.data || [];
  return {
    metrics: {
      outstandingReceivablesCents: sum(outstanding, "amount_due_cents") - sum(outstanding, "amount_paid_cents"),
      overdueReceivablesCents: sum(overdue, "amount_due_cents") - sum(overdue, "amount_paid_cents"),
      paidClubRevenueCents: sum(paidInvoices, "amount_paid_cents"),
      dancerPendingCents: safeIntegerCents(dancerFinancialSummary.pending_cents),
      dancerAvailableCents: safeIntegerCents(dancerFinancialSummary.available_cents),
      dancerProcessingCents: safeIntegerCents(dancerFinancialSummary.processing_cents),
      dancerPayableCents: safeIntegerCents(dancerFinancialSummary.available_cents),
      dancerPaidCents: safeIntegerCents(dancerFinancialSummary.paid_cents),
      reversedEarningsCents: safeIntegerCents(dancerFinancialSummary.reversed_cents),
      myDancrNetRevenueCents: sum(revenue.filter((row: any) => row.status === "settled"), "platform_commission_cents"),
      openInvoiceCount: outstanding.length,
      overdueInvoiceCount: overdue.length,
      failedPayoutCount: safeIntegerCents(dancerFinancialSummary.failed_payout_count),
      completedPayoutCount: safeIntegerCents(dancerFinancialSummary.completed_payout_count),
      natsPendingAccountCount: (natsAccountsResult.data || []).filter((row: any) => row.status === "requested").length,
      natsPendingExportCount: natsExports.filter((row: any) => ["waiting_for_affiliate", "pending", "processing"].includes(row.status)).length,
      natsReconciliationCount: natsExports.filter((row: any) => row.status === "reconciliation_required").length,
      natsExportedCents: sum(natsExports.filter((row: any) => row.status === "exported"), "amount_cents"),
    },
    invoices,
    payouts,
    earnings: commissions,
    earningsByVenue: earningGroup("venues", "Venue"),
    earningsByDancer: earningGroup("dancer_profiles", "Dancer"),
    settings: {
      ...settingsResult.data,
      environmentEnabled: getPayoutRuntimeConfig().enabledByEnvironment,
      providerConfigured,
      livePayoutsEnabled: Boolean(settingsResult.data?.payouts_enabled && getPayoutRuntimeConfig().enabledByEnvironment && providerConfigured),
    },
    auditEvents: auditResult.data || [],
    nats: {
      settlementProvider: natsConfig.settlementProvider,
      selected: natsConfig.selected,
      configured: natsConfig.configured,
      affiliatePortalUrl: natsConfig.affiliatePortalUrl,
      accounts: natsAccountsResult.data || [],
      exports: natsExports,
    },
  };
}

export async function getVenueFinance(client: DancrClient, userId: string) {
  const access = await requireVenueAccess(client, userId, "view_finance");
  const { data: venue, error: venueError } = await (client as any)
    .from("venues").select("id, name").eq("id", access.venueId).maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue profile not found.");
  const [{ data: account, error: accountError }, { data: invoices, error: invoiceError }] = await Promise.all([
    (client as any).from("club_finance_accounts").select("billing_email, collection_method, payment_terms_days, automatic_billing_enabled").eq("venue_id", venue.id).maybeSingle(),
    (client as any).from("club_invoices").select("id, period_start, period_end, sequence, status, currency, amount_due_cents, amount_paid_cents, due_at, hosted_invoice_url, invoice_pdf_url, paid_at, reminder_count").eq("venue_id", venue.id).order("created_at", { ascending: false }).limit(36),
  ]);
  if (accountError) throw accountError;
  if (invoiceError) throw invoiceError;
  return { venue, account, invoices: invoices || [] };
}

export async function getDancerFinance(client: DancrClient, userId: string) {
  const dancer = await getDancerForUser(client, userId);
  await (client as any).rpc("release_pending_dancer_earnings", { p_limit: MAX_FINANCE_ROWS });
  const settings = await getEffectivePayoutSettings(client);
  const natsConfig = getNatsRuntimeConfig();
  const [
    { data: account, error: accountError },
    { data: payouts, error: payoutError },
    { data: commissions, error: commissionError },
    { data: balanceSummary, error: balanceError },
    { data: natsAffiliateAccount, error: natsAccountError },
    { data: natsExports, error: natsExportsError },
  ] = await Promise.all([
    (client as any).from("dancer_payout_accounts").select("payment_provider, country, default_currency, onboarding_status, payout_eligibility, verification_status, details_submitted, payouts_enabled, last_error, updated_at").eq("dancer_id", dancer.id).eq("payment_provider", settings.paymentProvider).maybeSingle(),
    (client as any).from("dancer_payout_batches").select("id, status, currency, amount_cents, payment_provider, provider_reference_id, requested_at, processing_at, paid_at, failed_at, failure_message, is_test, created_at").eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(100),
    (client as any).from("commission_events").select("id, venue_id, earning_type, status, amount_cents, currency, created_at, pending_until, available_at, paid_at, held_at, is_test, venues(name)").eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(MAX_FINANCE_ROWS),
    (client as any).rpc("get_dancer_earnings_summary", { p_user_id: userId }),
    (client as any).from("nats_affiliate_accounts")
      .select("dancer_id, login_id, username, status, requested_at, activated_at, disabled_at, last_error, updated_at")
      .eq("dancer_id", dancer.id).maybeSingle(),
    (client as any).from("nats_commission_exports")
      .select("id, commission_event_id, amount_cents, currency, status, attempt_count, exported_at, failed_at, last_error, created_at")
      .eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(250),
  ]);
  if (accountError) throw accountError;
  if (payoutError) throw payoutError;
  if (commissionError) throw commissionError;
  if (balanceError) throw balanceError;
  if (natsAccountError) throw natsAccountError;
  if (natsExportsError) throw natsExportsError;
  const pendingCents = safeIntegerCents(balanceSummary?.pending_cents);
  const availableCents = safeIntegerCents(balanceSummary?.available_cents);
  const processingCents = safeIntegerCents(balanceSummary?.processing_cents);
  const lifetimeCents = safeIntegerCents(balanceSummary?.lifetime_cents);
  const paidCents = safeIntegerCents(balanceSummary?.paid_cents);
  return {
    dancer: { id: dancer.id, stageName: dancer.stage_name },
    payoutAccount: account,
    settings,
    balances: {
      pendingCents,
      availableCents,
      processingCents,
      lifetimeCents,
    },
    payableCents: availableCents,
    pendingClubPaymentCents: pendingCents,
    paidCents,
    earnings: commissions || [],
    payouts: payouts || [],
    commissionPlatform: {
      settlementProvider: natsConfig.settlementProvider,
      selected: natsConfig.selected,
      configured: natsConfig.configured,
      affiliatePortalUrl: natsConfig.affiliatePortalUrl,
    },
    natsAffiliateAccount,
    natsExports: natsExports || [],
  };
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function safeIntegerCents(value: unknown) {
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Financial amount exceeds the supported integer range.");
  }
  return parsed;
}
