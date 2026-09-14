import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "../stripe";

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function deliverClubInvoiceReminder(client: SupabaseClient, invoiceId: string, stripeInvoiceId: string, reminderKey: string) {
  const { data: claim, error } = await client.rpc("claim_club_invoice_reminder_delivery", {
    p_invoice_id: invoiceId, p_reminder_key: reminderKey, p_stripe_invoice_id: stripeInvoiceId,
  });
  if (error) throw error;
  if (["sent", "busy", "ineligible"].includes(claim?.status)) return false;
  if (claim?.status === "review_required") {
    throw new Error("A reminder delivery is uncertain. Review Stripe delivery before sending another reminder.");
  }
  if (claim?.status !== "claimed" || !uuid(claim.deliveryId) || !uuid(claim.attemptToken)
    || claim.stripeInvoiceId !== stripeInvoiceId || claim.idempotencyKey !== `mydancr-reminder-${claim.deliveryId}`
    || typeof claim.retryBefore !== "string" || !Number.isFinite(Date.parse(claim.retryBefore))
    || Date.parse(claim.retryBefore) <= Date.now() + 15_000) {
    throw new Error("Reminder delivery claim could not be confirmed.");
  }
  // Keep the reservation on every uncertain response. Reclaiming it reuses this
  // same provider key, and SQL stops retries before Stripe may expire that key.
  const sent = await getStripe().invoices.sendInvoice(stripeInvoiceId, {}, {
    idempotencyKey: claim.idempotencyKey, timeout: 10_000, maxNetworkRetries: 0,
  });
  if (sent.id !== stripeInvoiceId) throw new Error("Reminder provider receipt could not be confirmed.");
  const completed = await client.rpc("complete_club_invoice_reminder_delivery", {
    p_delivery_id: claim.deliveryId, p_attempt_token: claim.attemptToken, p_stripe_invoice_id: stripeInvoiceId,
  });
  if (completed.error) throw completed.error;
  if (completed.data?.deliveryId !== claim.deliveryId || completed.data.status !== "sent") {
    throw new Error("Reminder completion could not be confirmed. Review the delivery before retrying.");
  }
  return true;
}
