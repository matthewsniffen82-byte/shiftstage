import type { SupabaseClient } from "@supabase/supabase-js";

// Historical payout callbacks and statements remain available. No new dancer
// money movement is initiated, regardless of legacy environment/settings values.
export async function processDancerPayouts(_client: SupabaseClient) {
  return { created: 0, failed: 0, disabled: true, errors: [] as string[] };
}
