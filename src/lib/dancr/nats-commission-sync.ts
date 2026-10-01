import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithServerJob, serverJobRemainingMs } from "../server-job";
import {
  createNatsManualInvoice,
  getNatsRuntimeConfig,
  NatsAmbiguousDispatchError,
  NatsDefiniteRejectionError,
} from "./nats";

type DancrClient = SupabaseClient;

export type NatsCommissionSyncResult = {
  exported: number;
  failed: number;
  reconciliationRequired: number;
  disabled: boolean;
  errors: string[];
};

type ClaimedAgentExport = {
  export_id: string;
  agent_commission_event_id: string;
  agent_id: string;
  login_id: number | string;
  amount_cents: number | string;
  currency: string;
  attempt_count: number;
};

export async function syncNatsAgentCommissions(
  client: DancrClient,
  limit = 100,
): Promise<NatsCommissionSyncResult> {
  const config = getNatsRuntimeConfig();
  const result: NatsCommissionSyncResult = {
    exported: 0, failed: 0, reconciliationRequired: 0,
    disabled: !config.selected || !config.configured, errors: [],
  };
  if (result.disabled) return result;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError("Invalid export limit.");
  return runWithServerJob(async () => {
    for (let processed = 0; processed < limit; processed++) {
      // Reserve claim (5s), provider (15s), completion (5s), and failure receipt (5s).
      // Never lease the rest of the backlog before an invoice is dispatched.
      if (serverJobRemainingMs() < 30_000) break;
      const { data, error } = await runWithServerJob(async () =>
        await client.rpc("claim_nats_agent_commission_exports", { p_limit: 1 }), 5_000);
      if (error) throw error;
      const item = (data as ClaimedAgentExport[] | null)?.[0];
      if (!item) break;
      try {
        const invoice = await createNatsManualInvoice({
          loginId: safePositiveInteger(item.login_id, "NATS agent affiliate login ID"),
          amountCents: safePositiveInteger(item.amount_cents, "NATS agent commission amount"),
          currency: String(item.currency || "usd"),
        });
        const { data: completed, error: completeError } = await runWithServerJob(async () => await client.rpc("complete_nats_agent_commission_export", {
          p_export_id: item.export_id,
          p_nats_result: invoice.result,
          p_response_metadata: invoice.responseMetadata,
        }), 5_000);
        if (completeError) throw new NatsAmbiguousDispatchError(
          `NATS accepted the agent invoice but MyDancr could not record completion: ${financeError(completeError)}`,
          invoice.responseMetadata,
        );
        if (completed !== true) throw new NatsAmbiguousDispatchError(
          "NATS accepted the agent invoice but the MyDancr export lease changed. Reconcile before retrying.",
          invoice.responseMetadata,
        );
        result.exported += 1;
      } catch (caught) {
        const definite = caught instanceof NatsDefiniteRejectionError;
        const status = definite ? "failed" : "reconciliation_required";
        const responseMetadata = caught instanceof NatsDefiniteRejectionError || caught instanceof NatsAmbiguousDispatchError
          ? caught.responseMetadata : {};
        const message = financeError(caught);
        const { error: failureError } = await runWithServerJob(async () => await client.rpc("fail_nats_agent_commission_export", {
          p_export_id: item.export_id, p_status: status, p_error: message, p_response_metadata: responseMetadata,
        }), 5_000);
        if (failureError) result.errors.push(`Unable to record NATS agent export failure: ${financeError(failureError)}`);
        if (definite) result.failed += 1;
        else result.reconciliationRequired += 1;
        result.errors.push(message);
      }
    }
    return result;
  }, 50_000);
}

function safePositiveInteger(value: unknown, label: string) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} is invalid.`);
  return parsed;
}

function financeError(error: unknown) {
  return error instanceof NatsDefiniteRejectionError
    ? "NATS rejected the commission export. Review the affiliate invoice before retrying."
    : "NATS commission export outcome could not be confirmed. Verify the affiliate invoice in NATS before retrying.";
}
