import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  markStripeSubscriptionDeleted,
  syncCheckoutSessionSubscription,
  syncStripeSubscription,
} from "@/src/lib/dancr/payments";
import {
  markStripeInvoiceFailure,
  recordStripeFinanceWebhook,
  releaseStripeFinanceWebhookEvent,
  reverseDancerPayoutTransfer,
  syncDancerConnectAccount,
  syncStripeInvoice,
} from "@/src/lib/dancr/finance";
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
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid Stripe webhook." },
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
      const claimed = await recordStripeFinanceWebhook(admin, event);
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

        if (event.type === "transfer.reversed") {
          const transfer = event.data.object as Stripe.Transfer;
          await reverseDancerPayoutTransfer(admin, transfer.id, "Stripe reported that this payout transfer was reversed.");
        }
      } catch (error) {
        await releaseStripeFinanceWebhookEvent(admin, event.id);
        throw error;
      }
    }

    return NextResponse.json({ ok: true, received: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to process Stripe webhook." },
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
    "transfer.reversed",
  ].includes(type);
}
