import type { SupabaseClient } from "@supabase/supabase-js";
import { getDancerPayoutAccount, getEffectivePayoutSettings } from "./payout-account-store";
import { getPayoutProvider, type PayoutProviderName } from "./payout-provider";
import { getNatsRuntimeConfig } from "./nats";

type DancrClient = SupabaseClient;

const MAX_FINANCE_ROWS = 5_000;

export async function processDancerPayouts(client: DancrClient) {
  await (client as any).rpc("release_pending_dancer_earnings", { p_limit: MAX_FINANCE_ROWS });
  if (getNatsRuntimeConfig().selected) {
    return {
      created: 0,
      failed: 0,
      disabled: true,
      errors: [] as string[],
      settlementProvider: "nats" as const,
    };
  }
  const settings = await getEffectivePayoutSettings(client);
  if (!settings.payoutsEnabled) {
    return { created: 0, failed: 0, disabled: true, errors: [] as string[] };
  }

  if (settings.payoutMode === "scheduled" || settings.payoutMode === "both") {
    await createScheduledPayoutRequests(client, settings.minimumPayoutCents, settings.paymentProvider);
  }

  const { data: batches, error } = await (client as any).from("dancer_payout_batches")
    .select("id, dancer_id, amount_cents, currency, payment_provider, provider_reference_id, request_key, status, metadata")
    .in("status", ["requested", "processing"]).eq("is_test", false).order("requested_at", { ascending: true }).limit(250);
  if (error) throw error;

  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const batch of batches || []) {
    const dispatchKey = `mydancr-payout-${batch.id}`;
    const isDispatchRetry = batch.status === "processing" && batch.provider_reference_id === dispatchKey;
    if (batch.status === "processing" && !isDispatchRetry) continue;
    let dispatchStarted = isDispatchRetry;
    try {
      const providerName = String(batch.payment_provider || settings.paymentProvider) as PayoutProviderName;
      const payoutAccount = await getDancerPayoutAccount(client, batch.dancer_id, providerName);
      if (!payoutAccount || payoutAccount.payout_eligibility !== "eligible" || payoutAccount.verification_status !== "verified") {
        throw new Error("The dancer payout account is not currently eligible for payouts.");
      }
      const providerAccountId = String(payoutAccount.provider_account_id || "");
      if (!providerAccountId) throw new Error("The dancer payout account is missing its provider reference.");
      if (!dispatchStarted) {
        const { error: reserveError } = await (client as any).rpc("mark_dancer_payout_processing", {
          p_payout_id: batch.id,
          p_provider_reference_id: dispatchKey,
        });
        if (reserveError) throw reserveError;
        dispatchStarted = true;
      }
      const transfer = await getPayoutProvider(providerName).initiatePayout({
        payoutId: batch.id,
        dancerId: batch.dancer_id,
        providerAccountId,
        amountCents: Number(batch.amount_cents),
        currency: String(batch.currency || "usd"),
        idempotencyKey: dispatchKey,
      });
      const { error: processingError } = await (client as any).rpc("mark_dancer_payout_processing", {
        p_payout_id: batch.id,
        p_provider_reference_id: transfer.providerReferenceId,
      });
      if (processingError) throw processingError;
      created += 1;
    } catch (error) {
      failed += 1;
      const message = financeError(error);
      errors.push(message);
      if (dispatchStarted) {
        const { error: reviewError } = await (client as any).rpc("flag_dancer_payout_dispatch_review", {
          p_payout_id: batch.id,
          p_failure_message: message,
        });
        if (reviewError) errors.push(`Unable to audit provider dispatch review: ${financeError(reviewError)}`);
      } else {
        await (client as any).rpc("release_dancer_payout_batch", {
          p_batch_id: batch.id,
          p_status: "failed",
          p_failure_message: message,
        });
      }
    }
  }
  return { created, failed, disabled: false, errors };
}

async function createScheduledPayoutRequests(client: DancrClient, minimumPayoutCents: number, provider: PayoutProviderName) {
  const { data, error } = await (client as any).from("commission_events")
    .select("id, dancer_id, amount_cents, currency").eq("status", "available").is("payout_batch_id", null)
    .is("held_at", null).is("review_flag", null).order("created_at", { ascending: true }).limit(MAX_FINANCE_ROWS);
  if (error) throw error;
  const groups = new Map<string, any[]>();
  for (const earning of data || []) {
    const key = `${earning.dancer_id}:${earning.currency || "usd"}`;
    groups.set(key, [...(groups.get(key) || []), earning]);
  }
  for (const earnings of groups.values()) {
    const amount = earnings.reduce((total, earning) => total + Number(earning.amount_cents || 0), 0);
    if (amount < minimumPayoutCents) continue;
    const account = await getDancerPayoutAccount(client, earnings[0].dancer_id, provider);
    if (!account || account.payout_eligibility !== "eligible" || account.verification_status !== "verified") continue;
    const { error: batchError } = await (client as any).rpc("create_dancer_payout_batch", {
      p_dancer_id: earnings[0].dancer_id,
      p_currency: earnings[0].currency || "usd",
      p_commission_event_ids: earnings.map((earning) => earning.id),
      p_payment_provider: provider,
    });
    if (batchError && String(batchError.code) !== "23505") throw batchError;
  }
}

function financeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error) return String((error as any).message).slice(0, 500);
  return "Finance operation failed.";
}
