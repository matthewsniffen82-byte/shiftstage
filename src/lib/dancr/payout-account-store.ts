import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPayoutRuntimeConfig,
  isPayoutProviderConfigured,
  type PayoutMode,
  type PayoutProviderName,
  type ProviderAccountState,
} from "./payout-provider";

type DancrClient = SupabaseClient;

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
) {
  const { data, error } = await (client as any).from("dancer_payout_accounts").upsert({
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
    updated_at: new Date().toISOString(),
  }, { onConflict: "dancer_id,payment_provider" }).select("*").single();
  if (error) throw error;
  return data;
}

export async function getEffectivePayoutSettings(client: DancrClient) {
  const { data: database, error } = await (client as any).from("payout_settings").select("*").eq("id", "default").single();
  if (error) throw error;
  const runtime = getPayoutRuntimeConfig();
  const paymentProvider = String(database.payment_provider || runtime.provider) as PayoutProviderName;
  const providerConfigured = isPayoutProviderConfigured(paymentProvider);
  return {
    payoutsEnabled: Boolean(runtime.enabledByEnvironment && database.payouts_enabled && providerConfigured),
    environmentEnabled: runtime.enabledByEnvironment,
    databaseEnabled: Boolean(database.payouts_enabled),
    providerConfigured,
    paymentProvider,
    earningsHoldDays: Number(database.earnings_hold_days ?? runtime.holdDays),
    minimumPayoutCents: Number(database.minimum_payout_cents ?? runtime.minimumPayoutCents),
    payoutMode: String(database.payout_mode || runtime.mode) as PayoutMode,
  };
}
