import type Stripe from "stripe";
import { getStripe } from "../stripe";

export const PAYOUT_PROVIDERS = ["stripe", "adyen", "other"] as const;
export const PAYOUT_MODES = ["manual_cashout", "scheduled", "both"] as const;

export type PayoutProviderName = (typeof PAYOUT_PROVIDERS)[number];
export type PayoutMode = (typeof PAYOUT_MODES)[number];

export type PayoutRuntimeConfig = {
  enabledByEnvironment: boolean;
  provider: PayoutProviderName;
  holdDays: number;
  minimumPayoutCents: number;
  mode: PayoutMode;
};

export type ProviderAccountState = {
  providerAccountId: string;
  country: string;
  currency: string;
  onboardingStatus: "not_started" | "pending" | "complete" | "restricted" | "disabled";
  payoutEligibility: "ineligible" | "pending" | "eligible" | "restricted";
  verificationStatus: "unverified" | "pending" | "verified" | "restricted";
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  lastError: string | null;
  providerStatus: Record<string, unknown>;
};

export type PayoutInstruction = {
  payoutId: string;
  dancerId: string;
  providerAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
};

export interface PayoutProvider {
  readonly name: PayoutProviderName;
  createConnectedAccount(input: { dancerId: string; userId: string; email?: string | null }): Promise<ProviderAccountState>;
  createOnboardingLink(input: { providerAccountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string; expiresAt: number | null }>;
  retrieveConnectedAccount(providerAccountId: string): Promise<ProviderAccountState>;
  initiatePayout(input: PayoutInstruction): Promise<{ providerReferenceId: string }>;
}

export function getPayoutRuntimeConfig(): PayoutRuntimeConfig {
  return {
    enabledByEnvironment: process.env.PAYOUTS_ENABLED?.trim().toLowerCase() === "true",
    provider: enumValue(process.env.PAYOUT_PROVIDER, PAYOUT_PROVIDERS, "stripe"),
    holdDays: integerValue(process.env.EARNINGS_HOLD_DAYS, 7, 0, 90),
    minimumPayoutCents: integerValue(process.env.MINIMUM_PAYOUT_AMOUNT, 2000, 1, 10_000_000),
    mode: enumValue(process.env.PAYOUT_MODE, PAYOUT_MODES, "manual_cashout"),
  };
}

export function getPayoutProvider(name: PayoutProviderName): PayoutProvider {
  if (name === "stripe") return stripePayoutProvider;
  return unsupportedProvider(name);
}

export function isPayoutProviderConfigured(name: PayoutProviderName) {
  if (name === "stripe") {
    return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim());
  }
  return false;
}

export function stripeAccountState(account: Stripe.Account): ProviderAccountState {
  const currentlyDue = account.requirements?.currently_due || [];
  const disabledReason = account.requirements?.disabled_reason || null;
  const complete = Boolean(account.details_submitted && account.payouts_enabled && currentlyDue.length === 0 && !disabledReason);
  return {
    providerAccountId: account.id,
    country: account.country || "US",
    currency: account.default_currency || "usd",
    onboardingStatus: disabledReason ? "restricted" : complete ? "complete" : account.details_submitted ? "pending" : "not_started",
    payoutEligibility: disabledReason ? "restricted" : account.payouts_enabled ? "eligible" : account.details_submitted ? "pending" : "ineligible",
    verificationStatus: disabledReason ? "restricted" : complete ? "verified" : account.details_submitted ? "pending" : "unverified",
    detailsSubmitted: Boolean(account.details_submitted),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    lastError: disabledReason ? "Your payout account needs attention." : currentlyDue.length ? "Additional payout information is required." : null,
    providerStatus: {
      requirementsPending: currentlyDue.length > 0,
      futureRequirementsPending: Boolean(account.future_requirements?.currently_due?.length),
    },
  };
}

const stripePayoutProvider: PayoutProvider = {
  name: "stripe",
  async createConnectedAccount(input) {
    const account = await getStripe().accounts.create({
      type: "express",
      country: "US",
      email: input.email || undefined,
      business_type: "individual",
      capabilities: { transfers: { requested: true } },
      metadata: { dancer_id: input.dancerId, mydancr_user_id: input.userId },
    }, { idempotencyKey: `mydancr-dancer-connect-${input.dancerId}` });
    return stripeAccountState(account);
  },
  async createOnboardingLink(input) {
    const link = await getStripe().accountLinks.create({
      account: input.providerAccountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url, expiresAt: link.expires_at || null };
  },
  async retrieveConnectedAccount(providerAccountId) {
    return stripeAccountState(await getStripe().accounts.retrieve(providerAccountId));
  },
  async initiatePayout(input) {
    const transfer = await getStripe().transfers.create({
      amount: input.amountCents,
      currency: input.currency,
      destination: input.providerAccountId,
      description: "MyDancr dancer earnings payout",
      metadata: { payout_batch_id: input.payoutId, dancer_id: input.dancerId },
    }, { idempotencyKey: input.idempotencyKey });
    return { providerReferenceId: transfer.id };
  },
};

function unsupportedProvider(name: PayoutProviderName): PayoutProvider {
  const unavailable = async (): Promise<never> => {
    throw new Error(`${name} payout support is not configured.`);
  };
  return {
    name,
    createConnectedAccount: unavailable,
    createOnboardingLink: unavailable,
    retrieveConnectedAccount: unavailable,
    initiatePayout: unavailable,
  };
}

function enumValue<T extends string>(value: string | undefined, values: readonly T[], fallback: T): T {
  const normalized = value?.trim().toLowerCase() as T | undefined;
  return normalized && values.includes(normalized) ? normalized : fallback;
}

function integerValue(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
