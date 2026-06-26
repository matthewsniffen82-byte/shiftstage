import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  markStripeSubscriptionDeleted,
  syncCheckoutSessionSubscription,
  syncStripeSubscription,
} from "@/src/lib/dancr/payments";
import { getServerEnv } from "@/src/lib/env";
import { getStripe } from "@/src/lib/stripe";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });
  }

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

    return NextResponse.json({ ok: true, received: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to process Stripe webhook." },
      { status: 500 },
    );
  }
}
