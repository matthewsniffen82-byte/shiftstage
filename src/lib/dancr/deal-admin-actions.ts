import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function voidDealRedemption(client: DancrClient, redemptionId: string) {
  const { data, error } = await (client as any).rpc("void_generated_deal_redemption", {
    p_redemption_id: redemptionId,
    p_reason: "admin_marked_suspicious",
  });
  if (error) throw error;
  return data;
}
