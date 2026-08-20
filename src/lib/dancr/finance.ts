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
import {
  createMonthlyClubInvoiceDrafts,
  publishClubInvoiceDrafts,
  reconcileOpenClubInvoices,
  sendClubInvoiceReminders,
} from "./finance-invoices";
import { processDancerPayouts } from "./finance-payout-processing";
import { requireVenueAccess } from "./venue-access";

export {
  createMonthlyClubInvoiceDrafts,
  publishClubInvoiceDrafts,
  reconcileOpenClubInvoices,
  sendClubInvoiceReminders,
} from "./finance-invoices";
export { processDancerPayouts } from "./finance-payout-processing";

type DancrClient = SupabaseClient;
type FinanceRunResult = {
  invoicesCreated: number;
  invoicesOpened: number;
  invoicesReconciled: number;
  remindersSent: number;
  payoutsCreated: number;
  payoutsFailed: number;
  errors: string[];
};

const MAX_FINANCE_ROWS = 5_000;

export async function runQrFinanceAutomation(client: DancrClient): Promise<FinanceRunResult> {
  const result: FinanceRunResult = {
    invoicesCreated: 0,
    invoicesOpened: 0,
    invoicesReconciled: 0,
    remindersSent: 0,
    payoutsCreated: 0,
    payoutsFailed: 0,
    errors: [],
  };

  await captureFinanceStep(result, async () => {
    result.invoicesCreated = await createMonthlyClubInvoiceDrafts(client);
  });
  await captureFinanceStep(result, async () => {
    result.invoicesOpened = await publishClubInvoiceDrafts(client);
  });
  await captureFinanceStep(result, async () => {
    result.invoicesReconciled = await reconcileOpenClubInvoices(client);
  });
  await captureFinanceStep(result, async () => {
    result.remindersSent = await sendClubInvoiceReminders(client);
  });
  await captureFinanceStep(result, async () => {
    const payouts = await processDancerPayouts(client);
    result.payoutsCreated = payouts.created;
    result.payoutsFailed = payouts.failed;
    result.errors.push(...payouts.errors);
  });

  return result;
}

export async function getAdminFinanceOverview(client: DancrClient) {
  const now = new Date().toISOString();
  const [invoicesResult, payoutsResult, revenueResult, commissionsResult, settingsResult, auditResult, dancerFinancialSummaryResult] = await Promise.all([
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
  ]);
  for (const result of [invoicesResult, payoutsResult, revenueResult, commissionsResult, settingsResult, auditResult, dancerFinancialSummaryResult]) {
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
  const [
    { data: account, error: accountError },
    { data: payouts, error: payoutError },
    { data: commissions, error: commissionError },
    { data: balanceSummary, error: balanceError },
  ] = await Promise.all([
    (client as any).from("dancer_payout_accounts").select("payment_provider, country, default_currency, onboarding_status, payout_eligibility, verification_status, details_submitted, payouts_enabled, last_error, updated_at").eq("dancer_id", dancer.id).eq("payment_provider", settings.paymentProvider).maybeSingle(),
    (client as any).from("dancer_payout_batches").select("id, status, currency, amount_cents, payment_provider, provider_reference_id, requested_at, processing_at, paid_at, failed_at, failure_message, is_test, created_at").eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(100),
    (client as any).from("commission_events").select("id, venue_id, earning_type, status, amount_cents, currency, created_at, pending_until, available_at, paid_at, held_at, is_test, venues(name)").eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(MAX_FINANCE_ROWS),
    (client as any).rpc("get_dancer_earnings_summary", { p_user_id: userId }),
  ]);
  if (accountError) throw accountError;
  if (payoutError) throw payoutError;
  if (commissionError) throw commissionError;
  if (balanceError) throw balanceError;
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
  };
}

export async function getVenueStatementRows(client: DancrClient, userId: string, month: string) {
  const access = await requireVenueAccess(client, userId, "view_finance");
  const { data: venue, error: venueError } = await (client as any).from("venues").select("id, name").eq("id", access.venueId).maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue profile not found.");
  const { data, error } = await (client as any).from("deal_revenue_events")
    .select("id, source_type, gross_commission_cents, status, confirmed_at, venue_payment_received_at, club_deals(deal_title)")
    .eq("venue_id", venue.id).eq("commission_month", `${month}-01`).order("confirmed_at", { ascending: true }).limit(MAX_FINANCE_ROWS);
  if (error) throw error;
  return { owner: venue.name, month, rows: data || [] };
}

export async function getDancerStatementRows(client: DancrClient, userId: string, month: string) {
  const dancer = await getDancerForUser(client, userId);
  const { data, error } = await (client as any).from("commission_events")
    .select("id, status, amount_cents, gross_commission_cents, dancer_share_bps, created_at, paid_at, venues(name), club_deals(deal_title)")
    .eq("dancer_id", dancer.id).eq("commission_month", `${month}-01`).order("created_at", { ascending: true }).limit(MAX_FINANCE_ROWS);
  if (error) throw error;
  return { owner: dancer.stage_name, month, rows: data || [] };
}

export function venueStatementCsv(statement: Awaited<ReturnType<typeof getVenueStatementRows>>) {
  const header = ["Date", "Venue", "Deal", "Source", "MyDancr referral fee", "Venue payment status", "Venue payment received"];
  const rows = statement.rows.map((row: any) => [
    row.confirmed_at, statement.owner, joined(row.club_deals)?.deal_title || "Club Deal", row.source_type,
    cents(row.gross_commission_cents), row.status, row.venue_payment_received_at || "",
  ]);
  return csv([header, ...rows]);
}

export function dancerStatementCsv(statement: Awaited<ReturnType<typeof getDancerStatementRows>>) {
  const header = ["Date", "Dancer", "Venue", "Deal", "Gross commission", "Dancer rate", "Dancer commission", "Status", "Paid"];
  const rows = statement.rows.map((row: any) => [
    row.created_at, statement.owner, joined(row.venues)?.name || "Venue", joined(row.club_deals)?.deal_title || "Club Deal",
    cents(row.gross_commission_cents), `${Number(row.dancer_share_bps || 0) / 100}%`, cents(row.amount_cents), row.status, row.paid_at || "",
  ]);
  return csv([header, ...rows]);
}

async function captureFinanceStep(result: FinanceRunResult, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    result.errors.push(financeError(error));
  }
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function financeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error) return String((error as any).message).slice(0, 500);
  return "Finance operation failed.";
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

function cents(value: unknown) {
  return (Number(value || 0) / 100).toFixed(2);
}

function csv(rows: Array<Array<unknown>>) {
  return `${rows.map((row) => row.map((cell) => {
    const raw = String(cell ?? "");
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n")}\r\n`;
}
