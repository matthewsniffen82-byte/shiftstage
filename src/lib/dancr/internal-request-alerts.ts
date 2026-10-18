import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverInternalRequestPush } from "./internal-request-push";
import { deliverDancerTableRequestAlerts } from "./dancer-table-request-alerts";

export async function deliverInternalRequestAlerts(client: SupabaseClient, requestId?: string, options: { deadline?: number } = {}) {
  // Staff and dancer delivery settle independently within the same request budget.
  const results = await Promise.allSettled([
    deliverInternalRequestPush(client, requestId, options),
    deliverDancerTableRequestAlerts(client, requestId, options),
  ]);
  const counts = { configured: false, sent: 0, skipped: 0, retry: 0 };
  for (const result of results) {
    if (result.status === "rejected") continue;
    counts.configured ||= result.value.configured;
    counts.sent += result.value.sent;
    counts.skipped += result.value.skipped;
    counts.retry += result.value.retry;
  }
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return counts;
}
