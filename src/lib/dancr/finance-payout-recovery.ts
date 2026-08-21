import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function releaseFailedDancerPayoutBatch(
  client: DancrClient,
  batchId: string,
  failureMessage: string,
) {
  const { data, error } = await (client as any).rpc("release_dancer_payout_batch", {
    p_batch_id: batchId,
    p_status: "failed",
    p_failure_message: failureMessage,
  });
  if (error) throw error;
  return data;
}
