import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  markStripeSubscriptionDeleted,
  syncCheckoutSessionSubscription,
  syncStripeSubscription,
} from "@/src/lib/dancr/payments";
import {
  completeProviderPayout,
  finishPaymentProviderWebhook,
  markStripeInvoiceFailure,
  recordPaymentProviderWebhook,
  reverseDancerPayoutTransfer,
  syncDancerConnectAccount,
  syncStripeInvoice,
} from "@/src/lib/dancr/finance-provider-events";
import { getServerEnv } from "@/src/lib/env";
import { getStripe } from "@/src/lib/stripe";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, getServerEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (error) {
    console.warn("STRIPE_WEBHOOK_SIGNATURE_REJECTED", {
      message: internalWebhookError(error),
    });
    return NextResponse.json(
      { ok: false, error: "Invalid Stripe webhook." },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminSupabaseClient();

    if (event.type === "checkout.session.completed") {
      await syncCheckoutSessionSubscription(admin, event.data.object as Stripe.Checkout.Session);
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      await syncStripeSubscription(admin, event.data.object as Stripe.Subscription);
    }

    if (event.type === "customer.subscription.deleted") {
      await markStripeSubscriptionDeleted(admin, event.data.object as Stripe.Subscription);
    }

    if (isFinanceEvent(event.type)) {
      const object = event.data.object as { id?: string };
      const claimed = await recordPaymentProviderWebhook(admin, "stripe", {
        id: event.id, type: event.type, objectId: object.id || null,
      });
      if (!claimed) return NextResponse.json({ ok: true, received: true, duplicate: true });
      try {
        if (event.type.startsWith("invoice.")) {
          const invoice = event.data.object as Stripe.Invoice;
          if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
            await markStripeInvoiceFailure(admin, invoice, "Stripe could not collect this invoice. Payment is still required.");
          } else {
            await syncStripeInvoice(admin, invoice);
          }
        }

        if (event.type === "account.updated") {
          await syncDancerConnectAccount(admin, event.data.object as Stripe.Account);
        }

        if (event.type === "transfer.created") {
          const transfer = event.data.object as Stripe.Transfer;
          await completeProviderPayout(
            admin,
            transfer.id,
            new Date(event.created * 1000).toISOString(),
            transfer.metadata?.payout_batch_id || null,
          );
        }

        if (event.type === "transfer.reversed") {
          const transfer = event.data.object as Stripe.Transfer;
          await reverseDancerPayoutTransfer(admin, transfer.id, "Stripe reported that this payout transfer was reversed.");
        }
        await finishPaymentProviderWebhook(admin, "stripe", event.id);
      } catch (error) {
        await finishPaymentProviderWebhook(admin, "stripe", event.id, internalWebhookError(error));
        throw error;
      }
    }

    return NextResponse.json({ ok: true, received: true });
  } catch (error) {
    console.error("STRIPE_WEBHOOK_PROCESSING_FAILED", {
      eventId: event.id,
      eventType: event.type,
      message: internalWebhookError(error),
    });
    return NextResponse.json(
      { ok: false, error: "Unable to process Stripe webhook." },
      { status: 500 },
    );
  }
}

function isFinanceEvent(type: string) {
  return [
    "invoice.created",
    "invoice.finalized",
    "invoice.sent",
    "invoice.updated",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.payment_action_required",
    "invoice.voided",
    "invoice.marked_uncollectible",
    "account.updated",
    "transfer.created",
    "transfer.reversed",
  ].includes(type);
}

function internalWebhookError(error: unknown) {
  return (error instanceof Error ? error.message : "Webhook processing failed.").slice(0, 500);
}
