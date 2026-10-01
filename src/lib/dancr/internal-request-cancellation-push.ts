import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverInternalRequestPush, type InternalPushOptions } from "./internal-request-push";

// Cancellation and its inbox/outbox rows are committed by the same database RPC.
// Immediate delivery is optional: the cron worker claims the same durable jobs.
export function deliverInternalCancellationPush(client: SupabaseClient, requestId: string, options: InternalPushOptions = {}) {
  return deliverInternalRequestPush(client, requestId, { ...options, event: "cancelled" });
}
