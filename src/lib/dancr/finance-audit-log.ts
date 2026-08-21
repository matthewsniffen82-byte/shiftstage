import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function writeFinancialAuditEvent(
  client: DancrClient,
  event: Record<string, unknown>,
) {
  const { error } = await (client as any).from("financial_audit_events").insert(event);
  if (error) throw error;
}
