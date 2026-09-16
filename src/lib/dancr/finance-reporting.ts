import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVenueAccess } from "./venue-access";
import { getDancerForUser } from "./payout-account-store";

type DancrClient = SupabaseClient;

const MAX_FINANCE_ROWS = 5_000;

export async function getAdminFinanceOverview(client: DancrClient) {
  const [invoicesResult, payoutsResult, totalsResult, commissionsResult, auditResult, dancerFinancialSummaryResult] = await Promise.all([
    (client as any).from("club_invoices")
      .select("id, venue_id, period_start, period_end, sequence, status, currency, amount_due_cents, amount_paid_cents, due_at, hosted_invoice_url, invoice_pdf_url, external_payment_reference, paid_at, reminder_count, last_error, venues(name), club_invoice_reminder_deliveries(status)")
      .eq("club_invoice_reminder_deliveries.status", "review_required")
      .order("created_at", { ascending: false }).limit(200),
    (client as any).from("dancer_payout_batches")
      .select("id, dancer_id, status, currency, amount_cents, payment_provider, provider_reference_id, failure_message, requested_at, processing_at, paid_at, failed_at, is_test, created_at, dancer_profiles(stage_name)")
      .order("created_at", { ascending: false }).limit(200),
    (client as any).rpc("get_admin_finance_totals"),
    (client as any).from("commission_events")
      .select("id, qr_redemption_id, dancer_id, venue_id, club_deal_id, earning_type, status, amount_cents, currency, created_at, pending_until, available_at, held_at, hold_reason, review_flag, reversal_reason, is_test, dancer_profiles(stage_name), venues(name), club_deals(deal_title)")
      .order("created_at", { ascending: false }).limit(MAX_FINANCE_ROWS),
    (client as any).from("financial_audit_events").select("id, actor_type, action, target_type, target_id, reason, created_at")
      .order("created_at", { ascending: false }).limit(100),
    (client as any).rpc("get_admin_dancer_financial_summary"),
  ]);
  for (const result of [invoicesResult, payoutsResult, totalsResult, commissionsResult, auditResult, dancerFinancialSummaryResult]) {
    if (result.error) throw result.error;
  }
  const invoices = (invoicesResult.data || []).map(({ club_invoice_reminder_deliveries: deliveries, ...invoice }: any) => ({
    ...invoice,
    // Provider reconciliation can clear last_error; the durable hold remains visible.
    last_error: deliveries?.some((delivery: any) => delivery.status === "review_required")
      ? "A reminder delivery is uncertain. Review Stripe delivery before sending another reminder."
      : invoice.last_error,
  }));
  const payouts = payoutsResult.data || [];
  const totals = readAdminFinanceTotals(totalsResult.data);
  const commissions = commissionsResult.data || [];
  const dancerFinancialSummary = dancerFinancialSummaryResult.data || {};
  return {
    metrics: {
      ...totals.metrics,
      dancerPendingCents: safeIntegerCents(dancerFinancialSummary.pending_cents),
      dancerAvailableCents: safeIntegerCents(dancerFinancialSummary.available_cents),
      dancerProcessingCents: safeIntegerCents(dancerFinancialSummary.processing_cents),
      dancerPayableCents: safeIntegerCents(dancerFinancialSummary.available_cents),
      dancerPaidCents: safeIntegerCents(dancerFinancialSummary.paid_cents),
      reversedEarningsCents: safeIntegerCents(dancerFinancialSummary.reversed_cents),
      failedPayoutCount: safeIntegerCents(dancerFinancialSummary.failed_payout_count),
      completedPayoutCount: safeIntegerCents(dancerFinancialSummary.completed_payout_count),
    },
    invoices,
    payouts,
    earnings: commissions,
    earningsByVenue: totals.earningsByVenue,
    earningsByDancer: totals.earningsByDancer,
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
  const [
    { data: payouts, error: payoutError },
    { data: commissions, error: commissionError },
    { data: balanceSummary, error: balanceError },
  ] = await Promise.all([
    (client as any).from("dancer_payout_batches").select("id, status, currency, amount_cents, payment_provider, provider_reference_id, requested_at, processing_at, paid_at, failed_at, failure_message, is_test, created_at").eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(100),
    (client as any).from("commission_events").select("id, venue_id, earning_type, status, amount_cents, currency, created_at, pending_until, available_at, paid_at, held_at, is_test, venues(name)").eq("dancer_id", dancer.id).order("created_at", { ascending: false }).limit(MAX_FINANCE_ROWS),
    (client as any).rpc("get_dancer_earnings_summary", { p_user_id: userId }),
  ]);
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
    programStatus: "ended" as const,
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

function readAdminFinanceTotals(value: any) {
  const fields = ["outstandingReceivablesCents", "overdueReceivablesCents", "paidClubRevenueCents",
    "myDancrNetRevenueCents", "openInvoiceCount", "overdueInvoiceCount", "natsPendingAccountCount",
    "natsPendingExportCount", "natsReconciliationCount", "natsExportedCents"];
  const requiredInteger = (input: unknown) => {
    if (!(typeof input === "number" || (typeof input === "string" && /^\d+$/.test(input)))) {
      throw new Error("Financial totals could not be confirmed.");
    }
    return safeIntegerCents(input);
  };
  const metrics = Object.fromEntries(fields.map(field => [field, requiredInteger(value?.metrics?.[field])]));
  const groups = (items: any) => {
    if (!Array.isArray(items) || items.length > 10) throw new Error("Financial groups could not be confirmed.");
    return items.map(item => {
      if (typeof item?.name !== "string") throw new Error("Financial groups could not be confirmed.");
      return { name: item.name, amountCents: requiredInteger(item.amountCents), count: requiredInteger(item.count) };
    });
  };
  return { metrics, earningsByVenue: groups(value?.earningsByVenue), earningsByDancer: groups(value?.earningsByDancer) };
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
