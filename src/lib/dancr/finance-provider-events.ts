import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertDancerPayoutAccount } from "./payout-account-store";
import { stripeAccountState, type PayoutProviderName } from "./payout-provider";

type DancrClient = SupabaseClient;

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

export async function syncDancerConnectAccount(client: DancrClient, account: Stripe.Account) {
  const dancerId = account.metadata?.dancer_id;
  if (!dancerId) return null;
  return upsertDancerPayoutAccount(client, dancerId, "stripe", stripeAccountState(account));
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

export async function recordPaymentProviderWebhook(
  client: DancrClient,
  provider: PayoutProviderName,
  event: { id: string; type: string; objectId?: string | null },
) {
  const { data, error } = await (client as any).rpc("claim_payment_provider_webhook", {
    p_payment_provider: provider,
    p_provider_event_id: event.id,
    p_event_type: event.type,
    p_object_id: event.objectId || null,
  });
  if (error) throw error;
  return data === true;
}

export async function finishPaymentProviderWebhook(
  client: DancrClient,
  provider: PayoutProviderName,
  eventId: string,
  failureReason?: string,
) {
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

function stripeInvoiceStatus(invoice: Stripe.Invoice, currentStatus: string) {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "void") return "void";
  if (invoice.status === "uncollectible") return "uncollectible";
  if (invoice.status === "draft") return "draft";
  if (invoice.due_date && invoice.due_date * 1000 < Date.now()) return "overdue";
  return currentStatus === "overdue" ? "overdue" : "open";
}

function stripeId(value: string | { id: string } | null) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
