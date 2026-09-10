import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPayoutRuntimeConfig,
  isPayoutProviderConfigured,
  PAYOUT_PROVIDERS,
  type PayoutMode,
  type PayoutProviderName,
  type ProviderAccountState,
} from "./payout-provider";

type DancrClient = SupabaseClient;

type PayoutAccountVersion = {
  id: string;
  dancer_id: string;
  payment_provider: string;
  provider_account_id: string | null;
  updated_at: string;
};

export async function getDancerForUser(client: DancrClient, userId: string) {
  const { data: dancer, error } = await (client as any).from("dancer_profiles").select("id, stage_name").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!dancer) throw new Error("Dancer profile not found.");
  const { data: user, error: userError } = await (client as any).from("app_users").select("email").eq("id", userId).maybeSingle();
  if (userError) throw userError;
  return { ...dancer, email: user?.email || null };
}

export async function getDancerPayoutAccount(client: DancrClient, dancerId: string, provider?: PayoutProviderName) {
  let query = (client as any).from("dancer_payout_accounts").select("*").eq("dancer_id", dancerId);
  if (provider) query = query.eq("payment_provider", provider);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertDancerPayoutAccount(
  client: DancrClient,
  dancerId: string,
  provider: PayoutProviderName,
  account: ProviderAccountState,
  expected: PayoutAccountVersion | null,
) {
  const previousTime = expected ? Date.parse(expected.updated_at) : 0;
  if (expected !== null && (!expected || !expected.id || expected.dancer_id !== dancerId ||
    expected.payment_provider !== provider || !Number.isFinite(previousTime) ||
    (expected.provider_account_id && expected.provider_account_id !== account.providerAccountId))) {
    throw new Error("Payout account identity could not be confirmed.");
  }
  // Every caller captures this version before contacting the provider. Advance
  // it even for two local writes in one millisecond so a stale writer cannot win.
  const payload = {
    dancer_id: dancerId,
    payment_provider: provider,
    provider_account_id: account.providerAccountId,
    stripe_account_id: provider === "stripe" ? account.providerAccountId : null,
    country: account.country,
    default_currency: account.currency,
    onboarding_status: account.onboardingStatus,
    payout_eligibility: account.payoutEligibility,
    verification_status: account.verificationStatus,
    details_submitted: account.detailsSubmitted,
    charges_enabled: account.chargesEnabled,
    payouts_enabled: account.payoutsEnabled,
    onboarding_complete: account.onboardingStatus === "complete",
    last_error: account.lastError,
    provider_status: account.providerStatus,
    updated_at: new Date(Math.max(Date.now(), previousTime + 1)).toISOString(),
  };
  let query;
  if (expected) {
    query = (client as any).from("dancer_payout_accounts").update(payload)
      .eq("id", expected.id).eq("dancer_id", dancerId).eq("payment_provider", provider)
      .eq("updated_at", expected.updated_at);
    query = expected.provider_account_id === null
      ? query.is("provider_account_id", null)
      : query.eq("provider_account_id", expected.provider_account_id);
  } else {
    // A concurrent webhook or onboarding request must not overwrite the winner.
    query = (client as any).from("dancer_payout_accounts").upsert(payload, {
      onConflict: "dancer_id,payment_provider", ignoreDuplicates: true,
    });
  }
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data || data.dancer_id !== dancerId || data.payment_provider !== provider ||
    data.provider_account_id !== account.providerAccountId || (expected && data.id !== expected.id)) {
    throw new Error("Payout account changed. Refresh and try again.");
  }
  return data;
}

export async function getEffectivePayoutSettings(client: DancrClient) {
  const { data: database, error } = await (client as any).from("payout_settings").select("*").eq("id", "default").single();
  if (error) throw error;
  const runtime = getPayoutRuntimeConfig();
  const configuredProvider = String(database.payment_provider || runtime.provider).trim().toLowerCase();
  const providerSupported = PAYOUT_PROVIDERS.includes(configuredProvider as PayoutProviderName);
  const paymentProvider = (providerSupported ? configuredProvider : runtime.provider) as PayoutProviderName;
  const providerConfigured = providerSupported && isPayoutProviderConfigured(paymentProvider);
  return {
    payoutsEnabled: Boolean(runtime.enabledByEnvironment && database.payouts_enabled && providerConfigured && providerSupported),
    environmentEnabled: runtime.enabledByEnvironment,
    databaseEnabled: Boolean(database.payouts_enabled),
    providerConfigured,
    paymentProvider,
    earningsHoldDays: Number(database.earnings_hold_days ?? runtime.holdDays),
    minimumPayoutCents: Number(database.minimum_payout_cents ?? runtime.minimumPayoutCents),
    payoutMode: String(database.payout_mode || runtime.mode) as PayoutMode,
  };
}
