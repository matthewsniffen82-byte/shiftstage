import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function settleDealRevenueEvent(
  client: DancrClient,
  revenueEventId: string,
  action: "venue_payment_received",
  externalReference: string,
) {
  const { data, error } = await (client as any).rpc("settle_deal_revenue_event", {
    p_revenue_event_id: revenueEventId,
    p_action: action,
    p_external_reference: externalReference,
  });
  if (error) throw error;
  return data;
}

export async function settleDancerCommissionEvent(
  client: DancrClient,
  commissionEventId: string,
  externalReference: string,
) {
  const { data, error } = await (client as any).rpc("settle_dancer_commission_event", {
    p_commission_event_id: commissionEventId,
    p_external_reference: externalReference,
  });
  if (error) throw error;
  return data;
}

export async function voidDealRedemption(client: DancrClient, redemptionId: string) {
  const { data, error } = await (client as any).rpc("void_generated_deal_redemption", {
    p_redemption_id: redemptionId,
    p_reason: "admin_marked_suspicious",
  });
  if (error) throw error;
  return data;
}
