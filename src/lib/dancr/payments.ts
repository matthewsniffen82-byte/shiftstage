import type Stripe from "stripe";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "../env";
import { getStripe } from "../stripe";

type DancrClient = SupabaseClient;

export type BillingDancer = {
  id: string;
  userId: string;
  stageName: string;
  status: string;
};

export async function getBillingDancer(client: DancrClient, userId: string): Promise<BillingDancer> {
  const { data, error } = await (client as any)
    .from("dancer_profiles")
    .select("id, user_id, stage_name, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");

  return {
    id: data.id,
    userId: data.user_id,
    stageName: data.stage_name,
    status: data.status,
  };
}

export async function createDancerCheckoutSession(client: DancrClient, user: User) {
  const dancer = await getBillingDancer(client, user.id);
  if (dancer.status !== "approved") {
    throw new Error("Profile approval required before starting a subscription.");
  }

  const stripe = getStripe();
  const priceId = getServerEnv("STRIPE_DANCER_MONTHLY_PRICE_ID");
  const siteUrl = getPublicEnv().siteUrl.replace(/\/$/, "");
  const customerId = await getOrCreateStripeCustomer(client, stripe, dancer, user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/outputs/index.html?billing=success`,
    cancel_url: `${siteUrl}/outputs/index.html?billing=cancelled`,
    metadata: {
      dancerId: dancer.id,
      userId: user.id,
    },
    subscription_data: {
      metadata: {
        dancerId: dancer.id,
        userId: user.id,
      },
    },
  });

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}

export async function createDancerBillingPortalSession(client: DancrClient, userId: string) {
  const dancer = await getBillingDancer(client, userId);
  const subscription = await getSubscriptionRow(client, dancer.id);

  if (!subscription?.stripe_customer_id) {
    throw new Error("No Stripe customer found for this dancer.");
  }

  const siteUrl = getPublicEnv().siteUrl.replace(/\/$/, "");
  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${siteUrl}/outputs/index.html?billing=portal-return`,
  });

  return { portalUrl: session.url };
}

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

async function getOrCreateStripeCustomer(
  client: DancrClient,
  stripe: Stripe,
  dancer: BillingDancer,
  user: User,
) {
  const existing = await getSubscriptionRow(client, dancer.id);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: dancer.stageName,
    metadata: {
      dancerId: dancer.id,
      userId: user.id,
    },
  });

  const { error } = await (client as any).from("subscriptions").upsert(
    {
      dancer_id: dancer.id,
      stripe_customer_id: customer.id,
      status: "customer_created",
    },
    { onConflict: "dancer_id" },
  );

  if (error) throw error;
  return customer.id;
}

async function getSubscriptionRow(client: DancrClient, dancerId: string) {
  const { data, error } = await (client as any)
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status")
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
