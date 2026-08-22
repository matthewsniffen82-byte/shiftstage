import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export async function requestNatsAgentAffiliateLink(client: DancrClient, userId: string, input: {
  loginId: number;
  username?: string | null;
}) {
  const { data: agent, error: agentError } = await (client as any).from("sales_agents")
    .select("id, status").eq("user_id", userId).maybeSingle();
  if (agentError) throw agentError;
  if (!agent || agent.status !== "active") throw new Error("Active sales agent access required.");
  const { data: existing, error: existingError } = await (client as any).from("nats_agent_affiliate_accounts")
    .select("agent_id, status").eq("agent_id", agent.id).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "active") throw new Error("Your verified NATS account is already linked. Contact support before changing it.");
  const username = input.username?.trim() || null;
  const now = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_agent_affiliate_accounts").upsert({
    agent_id: agent.id, login_id: input.loginId, username, status: "requested",
    requested_at: now, activated_at: null, disabled_at: null, verified_by: null,
    verification_note: null, last_error: null, updated_at: now,
  }, { onConflict: "agent_id" }).select("agent_id, login_id, username, status, requested_at").single();
  if (error) {
    if (String(error.code) === "23505") throw new Error("That NATS affiliate login is already linked to another payee.");
    throw error;
  }
  await audit(client, userId, "agent", "nats_agent_affiliate_link_requested", "payout_account", agent.id,
    "Sales agent requested a NATS affiliate link.", { status: "requested", login_id: input.loginId, username });
  return data;
}

export async function verifyNatsAgentAffiliateLink(client: DancrClient, adminUserId: string, agentId: string, reason: string) {
  const { data: current, error: currentError } = await (client as any).from("nats_agent_affiliate_accounts")
    .select("agent_id, login_id, username, status").eq("agent_id", agentId).maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.status !== "requested") throw new Error("Only a requested NATS agent link can be verified.");
  const now = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_agent_affiliate_accounts").update({
    status: "active", activated_at: now, disabled_at: null, verified_by: adminUserId,
    verification_note: reason, last_error: null, updated_at: now,
  }).eq("agent_id", agentId).eq("status", "requested")
    .select("agent_id, login_id, username, status, activated_at").single();
  if (error) throw error;
  await audit(client, adminUserId, "admin", "nats_agent_affiliate_link_verified", "payout_account", agentId,
    reason, { status: "active", login_id: current.login_id, username: current.username });
  return data;
}

export async function disableNatsAgentAffiliateLink(client: DancrClient, adminUserId: string, agentId: string, reason: string) {
  const now = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_agent_affiliate_accounts").update({
    status: "disabled", disabled_at: now, verification_note: reason, updated_at: now,
  }).eq("agent_id", agentId).in("status", ["requested", "active"])
    .select("agent_id, login_id, username, status, disabled_at").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The NATS agent link is already disabled or was not found.");
  await audit(client, adminUserId, "admin", "nats_agent_affiliate_link_disabled", "payout_account", agentId,
    reason, { status: "disabled" });
  return data;
}

export async function reconcileNatsAgentCommissionExport(client: DancrClient, adminUserId: string, exportId: string,
  resolution: "confirmed_exported" | "confirmed_not_exported", reason: string) {
  const { data: current, error: currentError } = await (client as any).from("nats_agent_commission_exports")
    .select("id, status, agent_commission_event_id").eq("id", exportId).maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.status !== "reconciliation_required") throw new Error("Only an agent export requiring reconciliation can be resolved.");
  const now = new Date().toISOString();
  const nextStatus = resolution === "confirmed_exported" ? "exported" : "pending";
  const { data, error } = await (client as any).from("nats_agent_commission_exports").update({
    status: nextStatus, exported_at: resolution === "confirmed_exported" ? now : null,
    reconciled_at: now, nats_result: resolution === "confirmed_exported" ? `Admin confirmed in NATS: ${reason}` : null,
    last_error: null, failed_at: null, updated_at: now,
  }).eq("id", exportId).eq("status", "reconciliation_required")
    .select("id, status, agent_commission_event_id, reconciled_at").single();
  if (error) throw error;
  if (resolution === "confirmed_exported") {
    const { error: earningError } = await (client as any).from("agent_commission_events").update({
      status: "paid", paid_at: now, payout_reference: `NATS:${exportId}`,
    }).eq("id", current.agent_commission_event_id).eq("status", "payable");
    if (earningError) throw earningError;
  }
  await audit(client, adminUserId, "admin", "nats_agent_commission_export_reconciled", "agent_earning", exportId,
    reason, { status: nextStatus, resolution, agent_commission_event_id: current.agent_commission_event_id });
  return data;
}

export async function retryFailedNatsAgentCommissionExport(client: DancrClient, adminUserId: string, exportId: string, reason: string) {
  const now = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_agent_commission_exports").update({
    status: "pending", last_error: null, failed_at: null, reconciled_at: now, updated_at: now,
  }).eq("id", exportId).eq("status", "failed").select("id, status, agent_commission_event_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only a definitely rejected NATS agent export can be retried.");
  await audit(client, adminUserId, "admin", "nats_agent_commission_export_retry_authorized", "agent_earning", exportId,
    reason, { status: "pending", agent_commission_event_id: data.agent_commission_event_id });
  return data;
}

async function audit(client: DancrClient, userId: string, actorType: "admin" | "agent", action: string,
  targetType: "agent_earning" | "payout_account", targetId: string, reason: string, afterState: Record<string, unknown>) {
  const { error } = await (client as any).from("financial_audit_events").insert({
    actor_user_id: userId, actor_type: actorType, action, target_type: targetType,
    target_id: targetId, reason, after_state: afterState, metadata: { commission_platform: "nats" },
  });
  if (error) throw error;
}
