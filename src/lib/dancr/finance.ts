import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "../stripe";
import {
  getPayoutProvider,
  getPayoutRuntimeConfig,
  isPayoutProviderConfigured,
  stripeAccountState,
  type PayoutProviderName,
  type ProviderAccountState,
} from "./payout-provider";
import {
  getDancerForUser,
  getDancerPayoutAccount,
  getEffectivePayoutSettings,
  upsertDancerPayoutAccount,
} from "./payout-account-store";
import { requireVenueAccess } from "./venue-access";

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

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAYMENT_TERMS_DAYS = 15;
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

export async function createMonthlyClubInvoiceDrafts(client: DancrClient, now = new Date()) {
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const { data, error } = await (client as any)
    .from("deal_revenue_events")
    .select("id, venue_id, commission_month, gross_commission_cents, currency")
    .eq("status", "pending_venue_payment")
    .is("club_invoice_id", null)
    .lt("commission_month", currentMonth)
    .order("commission_month", { ascending: true })
    .limit(MAX_FINANCE_ROWS);
  if (error) throw error;

  const groups = new Map<string, Array<any>>();
  for (const row of data || []) {
    const key = `${row.venue_id}:${row.commission_month}:${row.currency || "usd"}`;
    const rows = groups.get(key) || [];
    rows.push(row);
    groups.set(key, rows);
  }

  let created = 0;
  for (const rows of groups.values()) {
    const first = rows[0];
    const periodStart = String(first.commission_month).slice(0, 10);
    const periodEnd = monthEnd(periodStart);
    const account = await getOrCreateFinanceAccountRow(client, first.venue_id);
    if (!account.automatic_billing_enabled) continue;
    const dueAt = new Date(now.getTime() + Number(account.payment_terms_days || DEFAULT_PAYMENT_TERMS_DAYS) * DAY_MS);
    const { data: invoiceId, error: rpcError } = await (client as any).rpc("create_club_invoice_draft", {
      p_venue_id: first.venue_id,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_due_at: dueAt.toISOString(),
      p_revenue_event_ids: rows.map((row) => row.id),
    });
    if (rpcError) throw rpcError;
    if (invoiceId) created += 1;
  }
  return created;
}

export async function publishClubInvoiceDrafts(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("club_invoices")
    .select("id, venue_id, period_start, period_end, sequence, status, currency, amount_due_cents, due_at, stripe_customer_id, stripe_invoice_id, venues(name, owner_user_id)")
    .in("status", ["draft", "failed"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;

  let opened = 0;
  for (const invoice of data || []) {
    try {
      await publishClubInvoice(client, invoice);
      opened += 1;
    } catch (error) {
      await (client as any).from("club_invoices").update({
        status: "failed",
        last_error: financeError(error),
        updated_at: new Date().toISOString(),
      }).eq("id", invoice.id);
    }
  }
  return opened;
}

async function publishClubInvoice(client: DancrClient, invoice: any) {
  const venue = joined(invoice.venues);
  if (!venue) throw new Error("Invoice venue is unavailable.");
  const account = await ensureStripeVenueCustomer(client, invoice.venue_id, venue);
  const stripe = getStripe();
  let stripeInvoice: Stripe.Invoice;

  if (invoice.stripe_invoice_id) {
    stripeInvoice = await stripe.invoices.retrieve(invoice.stripe_invoice_id);
  } else {
    stripeInvoice = await stripe.invoices.create({
      customer: account.stripe_customer_id,
      collection_method: account.collection_method,
      ...(account.collection_method === "send_invoice"
        ? { days_until_due: Number(account.payment_terms_days || DEFAULT_PAYMENT_TERMS_DAYS) }
        : {}),
      auto_advance: false,
      description: `MyDancr Club Deal commissions · ${invoice.period_start} through ${invoice.period_end}`,
      metadata: {
        mydancr_invoice_id: invoice.id,
        venue_id: invoice.venue_id,
        period_start: invoice.period_start,
        period_end: invoice.period_end,
      },
    }, { idempotencyKey: `mydancr-club-invoice-${invoice.id}` });

    await (client as any).from("club_invoices").update({
      stripe_customer_id: account.stripe_customer_id,
      stripe_invoice_id: stripeInvoice.id,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice.id);

    await stripe.invoiceItems.create({
      customer: account.stripe_customer_id,
      invoice: stripeInvoice.id,
      amount: Number(invoice.amount_due_cents),
      currency: String(invoice.currency || "usd"),
      description: `Confirmed MyDancr Club Deal redemptions · ${invoice.period_start}–${invoice.period_end}`,
      metadata: { mydancr_invoice_id: invoice.id },
    }, { idempotencyKey: `mydancr-club-invoice-item-${invoice.id}` });
  }

  if (stripeInvoice.status === "draft") {
    stripeInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id, { auto_advance: true });
  }
  if (stripeInvoice.status === "open" && stripeInvoice.collection_method === "send_invoice") {
    stripeInvoice = await stripe.invoices.sendInvoice(stripeInvoice.id);
  }

  await syncStripeInvoice(client, stripeInvoice);
}

export async function reconcileOpenClubInvoices(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("club_invoices")
    .select("id, stripe_invoice_id")
    .in("status", ["open", "overdue"])
    .not("stripe_invoice_id", "is", null)
    .limit(250);
  if (error) throw error;

  let reconciled = 0;
  for (const invoice of data || []) {
    const stripeInvoice = await getStripe().invoices.retrieve(invoice.stripe_invoice_id);
    await syncStripeInvoice(client, stripeInvoice);
    reconciled += 1;
  }
  return reconciled;
}

export async function syncStripeInvoice(client: DancrClient, invoice: Stripe.Invoice) {
  const invoiceId = invoice.metadata?.mydancr_invoice_id;
  const { data: record, error } = await (client as any)
    .from("club_invoices")
    .select("id, amount_due_cents, amount_paid_cents, status")
    .or(invoiceId ? `id.eq.${invoiceId},stripe_invoice_id.eq.${invoice.id}` : `stripe_invoice_id.eq.${invoice.id}`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!record) return null;

  const status = stripeInvoiceStatus(invoice, record.status);
  const paidAt = invoice.status_transitions?.paid_at
    ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
    : new Date().toISOString();
  const amountPaid = Math.min(Number(record.amount_due_cents), Number(invoice.amount_paid || 0));
  if (amountPaid > 0) {
    const { data, error: paymentError } = await (client as any).rpc("apply_club_invoice_payment", {
      p_invoice_id: record.id,
      p_total_paid_cents: amountPaid,
      p_payment_reference: `stripe:${invoice.id}`,
      p_paid_at: paidAt,
      p_stripe_invoice_id: invoice.id,
      p_hosted_invoice_url: invoice.hosted_invoice_url || null,
      p_invoice_pdf_url: invoice.invoice_pdf || null,
    });
    if (paymentError) throw paymentError;
    return data;
  }

  const dueAt = invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : undefined;
  const { data, error: updateError } = await (client as any).from("club_invoices").update({
    status,
    stripe_customer_id: stripeId(invoice.customer),
    stripe_invoice_id: invoice.id,
    hosted_invoice_url: invoice.hosted_invoice_url || null,
    invoice_pdf_url: invoice.invoice_pdf || null,
    ...(dueAt ? { due_at: dueAt } : {}),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", record.id).select("*").single();
  if (updateError) throw updateError;
  return data;
}

export async function markStripeInvoiceFailure(client: DancrClient, invoice: Stripe.Invoice, message: string) {
  const invoiceId = invoice.metadata?.mydancr_invoice_id;
  const { data, error } = await (client as any).from("club_invoices").update({
    status: invoice.due_date && invoice.due_date * 1000 < Date.now() ? "overdue" : "open",
    stripe_customer_id: stripeId(invoice.customer),
    stripe_invoice_id: invoice.id,
    hosted_invoice_url: invoice.hosted_invoice_url || null,
    invoice_pdf_url: invoice.invoice_pdf || null,
    last_error: message.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).or(invoiceId ? `id.eq.${invoiceId},stripe_invoice_id.eq.${invoice.id}` : `stripe_invoice_id.eq.${invoice.id}`)
    .select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function sendClubInvoiceReminders(client: DancrClient, now = new Date()) {
  const { data, error } = await (client as any)
    .from("club_invoices")
    .select("id, status, due_at, stripe_invoice_id, reminder_count")
    .in("status", ["open", "overdue"])
    .not("stripe_invoice_id", "is", null)
    .order("due_at", { ascending: true })
    .limit(250);
  if (error) throw error;

  let sent = 0;
  for (const invoice of data || []) {
    const dueAt = new Date(invoice.due_at);
    const daysFromDue = Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS);
    const reminderKey = daysFromDue >= 0
      ? daysFromDue <= 3 ? "due_soon" : null
      : `overdue_${Math.floor(Math.abs(daysFromDue) / 7) * 7}`;
    if (!reminderKey) continue;

    const { data: existing, error: reminderReadError } = await (client as any)
      .from("club_invoice_reminders")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("reminder_key", reminderKey)
      .maybeSingle();
    if (reminderReadError) throw reminderReadError;
    if (existing) continue;

    if (daysFromDue < 0 && invoice.status !== "overdue") {
      await (client as any).from("club_invoices").update({ status: "overdue", updated_at: now.toISOString() }).eq("id", invoice.id);
    }

    const stripeInvoice = await getStripe().invoices.retrieve(invoice.stripe_invoice_id);
    if (stripeInvoice.collection_method !== "send_invoice") continue;
    const sentInvoice = await getStripe().invoices.sendInvoice(invoice.stripe_invoice_id);
    const { error: reminderError } = await (client as any).from("club_invoice_reminders").insert({
      invoice_id: invoice.id,
      reminder_key: reminderKey,
      provider_reference: sentInvoice.id,
      audit: { due_at: invoice.due_at, days_from_due: daysFromDue },
    });
    if (reminderError) throw reminderError;
    await (client as any).from("club_invoices").update({
      last_reminder_at: now.toISOString(),
      reminder_count: Number(invoice.reminder_count || 0) + 1,
      updated_at: now.toISOString(),
    }).eq("id", invoice.id);
    sent += 1;
  }
  return sent;
}

export async function syncDancerConnectAccount(client: DancrClient, account: Stripe.Account) {
  const dancerId = account.metadata?.dancer_id;
  if (!dancerId) return null;
  return upsertDancerPayoutAccount(client, dancerId, "stripe", stripeAccountState(account));
}

export async function processDancerPayouts(client: DancrClient) {
  await (client as any).rpc("release_pending_dancer_earnings", { p_limit: MAX_FINANCE_ROWS });
  const settings = await getEffectivePayoutSettings(client);
  if (!settings.payoutsEnabled) {
    return { created: 0, failed: 0, disabled: true, errors: [] as string[] };
  }

  if (settings.payoutMode === "scheduled" || settings.payoutMode === "both") {
    await createScheduledPayoutRequests(client, settings.minimumPayoutCents, settings.paymentProvider);
  }

  const { data: batches, error } = await (client as any).from("dancer_payout_batches")
    .select("id, dancer_id, amount_cents, currency, payment_provider, provider_reference_id, request_key, status, metadata")
    .in("status", ["requested", "processing"]).eq("is_test", false).order("requested_at", { ascending: true }).limit(250);
  if (error) throw error;

  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const batch of batches || []) {
    const dispatchKey = `mydancr-payout-${batch.id}`;
    const isDispatchRetry = batch.status === "processing" && batch.provider_reference_id === dispatchKey;
    if (batch.status === "processing" && !isDispatchRetry) continue;
    let dispatchStarted = isDispatchRetry;
    try {
      const providerName = String(batch.payment_provider || settings.paymentProvider) as PayoutProviderName;
      const payoutAccount = await getDancerPayoutAccount(client, batch.dancer_id, providerName);
      if (!payoutAccount || payoutAccount.payout_eligibility !== "eligible" || payoutAccount.verification_status !== "verified") {
        throw new Error("The dancer payout account is not currently eligible for payouts.");
      }
      const providerAccountId = String(payoutAccount.provider_account_id || "");
      if (!providerAccountId) throw new Error("The dancer payout account is missing its provider reference.");
      if (!dispatchStarted) {
        const { error: reserveError } = await (client as any).rpc("mark_dancer_payout_processing", {
          p_payout_id: batch.id,
          p_provider_reference_id: dispatchKey,
        });
        if (reserveError) throw reserveError;
        dispatchStarted = true;
      }
      const transfer = await getPayoutProvider(providerName).initiatePayout({
        payoutId: batch.id,
        dancerId: batch.dancer_id,
        providerAccountId,
        amountCents: Number(batch.amount_cents),
        currency: String(batch.currency || "usd"),
        idempotencyKey: dispatchKey,
      });
      const { error: processingError } = await (client as any).rpc("mark_dancer_payout_processing", {
        p_payout_id: batch.id,
        p_provider_reference_id: transfer.providerReferenceId,
      });
      if (processingError) throw processingError;
      if (providerName === "bitsafe") {
        const { error: auditError } = await (client as any).from("financial_audit_events").insert({
          actor_type: "system",
          action: "bitsafe_payout_instruction_created",
          target_type: "payout",
          target_id: batch.id,
          reason: "Awaiting approval and execution in the Yoursafe business portal.",
          metadata: {
            payment_provider: "bitsafe",
            provider_reference_id: transfer.providerReferenceId,
            automatic_paid_confirmation: false,
          },
        });
        if (auditError) throw auditError;
      }
      created += 1;
    } catch (error) {
      failed += 1;
      const message = financeError(error);
      errors.push(message);
      if (dispatchStarted) {
        const { error: reviewError } = await (client as any).rpc("flag_dancer_payout_dispatch_review", {
          p_payout_id: batch.id,
          p_failure_message: message,
        });
        if (reviewError) errors.push(`Unable to audit provider dispatch review: ${financeError(reviewError)}`);
      } else {
        await (client as any).rpc("release_dancer_payout_batch", {
          p_batch_id: batch.id,
          p_status: "failed",
          p_failure_message: message,
        });
      }
    }
  }
  return { created, failed, disabled: false, errors };
}

export async function reverseDancerPayoutTransfer(client: DancrClient, transferId: string, message: string) {
  const { data: batch, error } = await (client as any)
    .from("dancer_payout_batches")
    .select("id, status")
    .eq("provider_reference_id", transferId)
    .maybeSingle();
  if (error) throw error;
  if (!batch) return null;
  if (batch.status === "paid") {
    const { error: recoveryError } = await (client as any).from("commission_events").update({
      recovery_required: true,
      review_flag: "paid_payout_reversed_by_provider",
    }).eq("payout_batch_id", batch.id).eq("status", "paid");
    if (recoveryError) throw recoveryError;
    await (client as any).from("financial_audit_events").insert({
      actor_type: "provider", action: "paid_payout_recovery_required", target_type: "payout",
      target_id: batch.id, reason: message.slice(0, 500),
      metadata: { provider_reference_id: transferId, automatic_debit_attempted: false },
    });
    return { id: batch.id, status: "paid", recoveryRequired: true };
  }
  const { data, error: releaseError } = await (client as any).rpc("release_dancer_payout_batch", {
    p_batch_id: batch.id,
    p_status: "failed",
    p_failure_message: message,
  });
  if (releaseError) throw releaseError;
  return data;
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

export async function recordPaymentProviderWebhook(client: DancrClient, provider: PayoutProviderName, event: { id: string; type: string; objectId?: string | null }) {
  const { data, error } = await (client as any).rpc("claim_payment_provider_webhook", {
    p_payment_provider: provider,
    p_provider_event_id: event.id,
    p_event_type: event.type,
    p_object_id: event.objectId || null,
  });
  if (error) throw error;
  return data === true;
}

export async function finishPaymentProviderWebhook(client: DancrClient, provider: PayoutProviderName, eventId: string, failureReason?: string) {
  const { error } = await (client as any).from("payment_provider_webhook_events").update({
    processing_status: failureReason ? "failed" : "processed",
    failure_reason: failureReason ? failureReason.slice(0, 500) : null,
    processed_at: new Date().toISOString(),
  }).eq("payment_provider", provider).eq("provider_event_id", eventId).eq("processing_status", "processing");
  if (error) throw error;
}

export async function completeProviderPayout(
  client: DancrClient,
  providerReferenceId: string,
  paidAt = new Date().toISOString(),
  internalPayoutId?: string | null,
) {
  const query = (client as any).from("dancer_payout_batches")
    .select("id").eq("provider_reference_id", providerReferenceId).maybeSingle();
  let { data: payout, error } = await query;
  if (error) throw error;
  if (!payout && internalPayoutId) {
    const fallback = await (client as any).from("dancer_payout_batches")
      .select("id").eq("id", internalPayoutId).eq("status", "processing").maybeSingle();
    payout = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  if (!payout) return null;
  const { data, error: completeError } = await (client as any).rpc("complete_dancer_payout_batch", {
    p_batch_id: payout.id, p_transfer_id: providerReferenceId, p_paid_at: paidAt,
  });
  if (completeError) throw completeError;
  return data;
}

async function getOrCreateFinanceAccountRow(client: DancrClient, venueId: string) {
  const { data: existing, error } = await (client as any).from("club_finance_accounts").select("*").eq("venue_id", venueId).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const { data, error: insertError } = await (client as any).from("club_finance_accounts").insert({ venue_id: venueId }).select("*").single();
  if (insertError) throw insertError;
  return data;
}

async function ensureStripeVenueCustomer(client: DancrClient, venueId: string, venue: any) {
  const financeAccount = await getOrCreateFinanceAccountRow(client, venueId);
  if (financeAccount.stripe_customer_id) return financeAccount;
  const { data: owner, error: ownerError } = await (client as any).from("app_users").select("email").eq("id", venue.owner_user_id).maybeSingle();
  if (ownerError) throw ownerError;
  const customer = await getStripe().customers.create({
    name: venue.name || "MyDancr venue",
    email: financeAccount.billing_email || owner?.email || undefined,
    metadata: { venue_id: venueId, product: "mydancr_qr_commissions" },
  }, { idempotencyKey: `mydancr-venue-customer-${venueId}` });
  const { data, error } = await (client as any).from("club_finance_accounts").update({
    stripe_customer_id: customer.id,
    billing_email: financeAccount.billing_email || owner?.email || null,
    updated_at: new Date().toISOString(),
  }).eq("venue_id", venueId).select("*").single();
  if (error) throw error;
  return data;
}

export async function syncBitsafePayoutAccount(client: DancrClient, dancerId: string, account: ProviderAccountState) {
  return upsertDancerPayoutAccount(client, dancerId, "bitsafe", account);
}

async function createScheduledPayoutRequests(client: DancrClient, minimumPayoutCents: number, provider: PayoutProviderName) {
  const { data, error } = await (client as any).from("commission_events")
    .select("id, dancer_id, amount_cents, currency").eq("status", "available").is("payout_batch_id", null)
    .is("held_at", null).is("review_flag", null).order("created_at", { ascending: true }).limit(MAX_FINANCE_ROWS);
  if (error) throw error;
  const groups = new Map<string, any[]>();
  for (const earning of data || []) {
    const key = `${earning.dancer_id}:${earning.currency || "usd"}`;
    groups.set(key, [...(groups.get(key) || []), earning]);
  }
  for (const earnings of groups.values()) {
    const amount = earnings.reduce((total, earning) => total + Number(earning.amount_cents || 0), 0);
    if (amount < minimumPayoutCents) continue;
    const account = await getDancerPayoutAccount(client, earnings[0].dancer_id, provider);
    if (!account || account.payout_eligibility !== "eligible" || account.verification_status !== "verified") continue;
    const { error: batchError } = await (client as any).rpc("create_dancer_payout_batch", {
      p_dancer_id: earnings[0].dancer_id,
      p_currency: earnings[0].currency || "usd",
      p_commission_event_ids: earnings.map((earning) => earning.id),
      p_payment_provider: provider,
    });
    if (batchError && String(batchError.code) !== "23505") throw batchError;
  }
}

async function captureFinanceStep(result: FinanceRunResult, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    result.errors.push(financeError(error));
  }
}

function stripeInvoiceStatus(invoice: Stripe.Invoice, currentStatus: string) {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "void") return "void";
  if (invoice.status === "uncollectible") return "uncollectible";
  if (invoice.status === "draft") return "draft";
  if (invoice.due_date && invoice.due_date * 1000 < Date.now()) return "overdue";
  return currentStatus === "overdue" ? "overdue" : "open";
}

function monthEnd(monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function stripeId(value: string | { id: string } | null) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
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
