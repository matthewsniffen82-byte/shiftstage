import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "../stripe";
import { syncStripeInvoice } from "./finance-provider-events";

type DancrClient = SupabaseClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAYMENT_TERMS_DAYS = 15;
const MAX_FINANCE_ROWS = 5_000;

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

function monthEnd(monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function financeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error) return String((error as any).message).slice(0, 500);
  return "Finance operation failed.";
}
