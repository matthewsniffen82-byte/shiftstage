import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNatsManualInvoice,
  getNatsRuntimeConfig,
  NatsAmbiguousDispatchError,
  NatsDefiniteRejectionError,
} from "./nats";

type DancrClient = SupabaseClient;

type ClaimedExport = {
  export_id: string;
  commission_event_id: string;
  dancer_id: string;
  login_id: number | string;
  amount_cents: number | string;
  currency: string;
  attempt_count: number;
};

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

export async function syncNatsCommissions(
  client: DancrClient,
  limit = 100,
): Promise<NatsCommissionSyncResult> {
  const config = getNatsRuntimeConfig();
  const result: NatsCommissionSyncResult = {
    exported: 0,
    failed: 0,
    reconciliationRequired: 0,
    disabled: !config.selected || !config.configured,
    errors: [],
  };
  if (result.disabled) return result;

  const { data, error } = await (client as any).rpc("claim_nats_commission_exports", { p_limit: limit });
  if (error) throw error;
  for (const item of data as ClaimedExport[] || []) {
    try {
      const invoice = await createNatsManualInvoice({
        loginId: safePositiveInteger(item.login_id, "NATS affiliate login ID"),
        amountCents: safePositiveInteger(item.amount_cents, "NATS commission amount"),
        currency: String(item.currency || "usd"),
      });
      const { data: completed, error: completeError } = await (client as any).rpc("complete_nats_commission_export", {
        p_export_id: item.export_id,
        p_nats_result: invoice.result,
        p_response_metadata: invoice.responseMetadata,
      });
      if (completeError) throw new NatsAmbiguousDispatchError(
        `NATS accepted the invoice but MyDancr could not record completion: ${financeError(completeError)}`,
        invoice.responseMetadata,
      );
      if (completed !== true) throw new NatsAmbiguousDispatchError(
        "NATS accepted the invoice but the MyDancr export lease changed. Reconcile before retrying.",
        invoice.responseMetadata,
      );
      result.exported += 1;
    } catch (caught) {
      const definite = caught instanceof NatsDefiniteRejectionError;
      const status = definite ? "failed" : "reconciliation_required";
      const responseMetadata = caught instanceof NatsDefiniteRejectionError || caught instanceof NatsAmbiguousDispatchError
        ? caught.responseMetadata
        : {};
      const message = financeError(caught);
      const { error: failureError } = await (client as any).rpc("fail_nats_commission_export", {
        p_export_id: item.export_id,
        p_status: status,
        p_error: message,
        p_response_metadata: responseMetadata,
      });
      if (failureError) result.errors.push(`Unable to record NATS export failure: ${financeError(failureError)}`);
      if (definite) result.failed += 1;
      else result.reconciliationRequired += 1;
      result.errors.push(message);
    }
  }
  return result;
}

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
  const { data, error } = await (client as any).rpc("claim_nats_agent_commission_exports", { p_limit: limit });
  if (error) throw error;
  for (const item of data as ClaimedAgentExport[] || []) {
    try {
      const invoice = await createNatsManualInvoice({
        loginId: safePositiveInteger(item.login_id, "NATS agent affiliate login ID"),
        amountCents: safePositiveInteger(item.amount_cents, "NATS agent commission amount"),
        currency: String(item.currency || "usd"),
      });
      const { data: completed, error: completeError } = await (client as any).rpc("complete_nats_agent_commission_export", {
        p_export_id: item.export_id,
        p_nats_result: invoice.result,
        p_response_metadata: invoice.responseMetadata,
      });
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
      const { error: failureError } = await (client as any).rpc("fail_nats_agent_commission_export", {
        p_export_id: item.export_id, p_status: status, p_error: message, p_response_metadata: responseMetadata,
      });
      if (failureError) result.errors.push(`Unable to record NATS agent export failure: ${financeError(failureError)}`);
      if (definite) result.failed += 1;
      else result.reconciliationRequired += 1;
      result.errors.push(message);
    }
  }
  return result;
}

function safePositiveInteger(value: unknown, label: string) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} is invalid.`);
  return parsed;
}

function financeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (error && typeof error === "object" && "message" in error) return String((error as any).message).slice(0, 500);
  return "NATS commission export failed.";
}
