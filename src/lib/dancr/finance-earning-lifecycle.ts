import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export const MAX_EARNINGS_RELEASE_ROWS = 5_000;

export async function releasePendingDancerEarnings(client: DancrClient) {
  const { data, error } = await (client as any).rpc("release_pending_dancer_earnings", {
    p_limit: MAX_EARNINGS_RELEASE_ROWS,
  });
  if (error) throw error;
  return data;
}
