import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "../stripe";

type DancrClient = SupabaseClient;

export async function syncStripeSubscription(client: DancrClient, subscription: Stripe.Subscription) {
  const dancerId = subscription.metadata?.dancerId;
  if (!dancerId) return;

  const item = subscription.items.data[0];
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await (client as any).from("subscriptions").upsert(
    {
      dancer_id: dancerId,
      stripe_customer_id: asStripeId(subscription.customer),
      stripe_subscription_id: subscription.id,
      stripe_price_id: item?.price?.id || null,
      status: subscription.status,
      current_period_end: currentPeriodEnd,
    },
    { onConflict: "dancer_id" },
  );

  if (error) throw error;
}

export async function syncCheckoutSessionSubscription(client: DancrClient, session: Stripe.Checkout.Session) {
  const dancerId = session.metadata?.dancerId;
  const subscriptionId = asStripeId(session.subscription);
  if (!dancerId || !subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  await syncStripeSubscription(client, subscription);
}

export async function markStripeSubscriptionDeleted(client: DancrClient, subscription: Stripe.Subscription) {
  const dancerId = subscription.metadata?.dancerId;
  if (!dancerId) return;

  const { error } = await (client as any)
    .from("subscriptions")
    .update({
      status: subscription.status || "canceled",
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("dancer_id", dancerId);

  if (error) throw error;
}

async function getSubscriptionRow(client: DancrClient, dancerId: string) {
  const { data, error } = await (client as any)
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, current_period_end")
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function asStripeId(value: string | { id: string } | null) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id;
}
