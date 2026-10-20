import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternalPushOptions } from "./internal-request-push";
import { deliverInternalRequestAlerts } from "./internal-request-alerts";

// Cancellation and its inbox/outbox rows are committed by the same database RPC.
// Immediate delivery is optional: the cron worker claims the same durable jobs.
export function deliverInternalCancellationPush(client: SupabaseClient, requestId: string, options: InternalPushOptions = {}) {
  return deliverInternalRequestAlerts(client, requestId, { ...options, event: "cancelled" });
}
