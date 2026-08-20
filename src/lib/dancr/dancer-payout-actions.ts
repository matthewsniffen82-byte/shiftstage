import type { SupabaseClient } from "@supabase/supabase-js";
import { createBitsafeOnboarding } from "./bitsafe";
import { getDancerFinance } from "./finance-reporting";
import {
  getDancerForUser,
  getDancerPayoutAccount,
  getEffectivePayoutSettings,
  upsertDancerPayoutAccount,
} from "./payout-account-store";
import { getPayoutProvider } from "./payout-provider";

type DancrClient = SupabaseClient;

export async function createDancerConnectOnboarding(
  client: DancrClient,
  userId: string,
  returnUrl: string,
  refreshUrl: string,
) {
  const dancer = await getDancerForUser(client, userId);
  const settings = await getEffectivePayoutSettings(client);
  if (!settings.payoutsEnabled) {
    throw new Error("Payout setup will open after MyDancr's payout provider is approved and enabled.");
  }
  if (settings.paymentProvider === "bitsafe") {
    const callbackUrl = new URL("/api/bitsafe/callback", returnUrl).toString();
    return createBitsafeOnboarding(client, {
      dancerId: dancer.id,
      userId,
      returnUrl,
      callbackUrl,
    });
  }
  let payoutAccount = await getDancerPayoutAccount(client, dancer.id, settings.paymentProvider);
  const provider = getPayoutProvider(settings.paymentProvider);

  if (!payoutAccount) {
    const account = await provider.createConnectedAccount({ dancerId: dancer.id, userId, email: dancer.email });
    payoutAccount = await upsertDancerPayoutAccount(client, dancer.id, settings.paymentProvider, account);
  }

  const providerAccountId = String(payoutAccount.provider_account_id || "");
  if (!providerAccountId) throw new Error("Payout account setup is incomplete.");
  const accountLink = await provider.createOnboardingLink({
    providerAccountId,
    refreshUrl,
    returnUrl,
  });
  return { url: accountLink.url, expiresAt: accountLink.expiresAt };
}

export async function refreshDancerConnectAccount(client: DancrClient, userId: string) {
  const dancer = await getDancerForUser(client, userId);
  const settings = await getEffectivePayoutSettings(client);
  if (!settings.payoutsEnabled) return null;
  const payoutAccount = await getDancerPayoutAccount(client, dancer.id, settings.paymentProvider);
  if (!payoutAccount) return null;
  const providerAccountId = String(payoutAccount.provider_account_id || "");
  if (!providerAccountId) return null;
  const account = await getPayoutProvider(settings.paymentProvider).retrieveConnectedAccount(providerAccountId);
  return upsertDancerPayoutAccount(client, dancer.id, settings.paymentProvider, account);
}

export async function requestDancerCashOut(client: DancrClient, userId: string, requestKey: string) {
  const settings = await getEffectivePayoutSettings(client);
  if (!settings.payoutsEnabled) throw new Error("Cash out is not live while payout approval is pending.");
  if (settings.payoutMode !== "manual_cashout" && settings.payoutMode !== "both") {
    throw new Error("Manual cash out is not currently enabled.");
  }
  const preview = await getDancerFinance(client, userId);
  if (Number(preview.balances.availableCents || 0) < settings.minimumPayoutCents) {
    throw new Error("Available earnings do not meet the minimum cash-out amount.");
  }
  const { data, error } = await (client as any).rpc("request_dancer_payout", {
    p_user_id: userId,
    p_request_key: requestKey,
    p_payment_provider: settings.paymentProvider,
    p_is_test: false,
  });
  if (error) throw error;
  return data;
}
