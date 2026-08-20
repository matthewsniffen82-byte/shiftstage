import type { SupabaseClient } from "@supabase/supabase-js";
import { getDancerForUser } from "./payout-account-store";

type DancrClient = SupabaseClient;

export async function requestNatsAffiliateLink(
  client: DancrClient,
  userId: string,
  input: { loginId: number; username?: string | null },
) {
  const dancer = await getDancerForUser(client, userId);
  const { data: existing, error: existingError } = await (client as any)
    .from("nats_affiliate_accounts")
    .select("dancer_id, status")
    .eq("dancer_id", dancer.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "active") {
    throw new Error("Your verified NATS account is already linked. Contact support before changing it.");
  }
  const username = input.username?.trim() || null;
  const { data, error } = await (client as any).from("nats_affiliate_accounts").upsert({
    dancer_id: dancer.id,
    login_id: input.loginId,
    username,
    status: "requested",
    requested_at: new Date().toISOString(),
    activated_at: null,
    disabled_at: null,
    verified_by: null,
    verification_note: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "dancer_id" }).select("dancer_id, login_id, username, status, requested_at").single();
  if (error) {
    if (String(error.code) === "23505") throw new Error("That NATS affiliate login is already linked to another dancer.");
    throw error;
  }
  const { error: auditError } = await (client as any).from("financial_audit_events").insert({
    actor_user_id: userId,
    actor_type: "dancer",
    action: "nats_affiliate_link_requested",
    target_type: "payout_account",
    target_id: dancer.id,
    after_state: { status: "requested", login_id: input.loginId, username },
    metadata: { commission_platform: "nats" },
  });
  if (auditError) throw auditError;
  return data;
}

export async function verifyNatsAffiliateLink(
  client: DancrClient,
  adminUserId: string,
  dancerId: string,
  reason: string,
) {
  const { data: account, error: accountError } = await (client as any)
    .from("nats_affiliate_accounts")
    .select("dancer_id, login_id, username, status")
    .eq("dancer_id", dancerId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.status !== "requested") throw new Error("Only a requested NATS affiliate link can be verified.");
  const activatedAt = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_affiliate_accounts").update({
    status: "active",
    activated_at: activatedAt,
    disabled_at: null,
    verified_by: adminUserId,
    verification_note: reason,
    last_error: null,
    updated_at: activatedAt,
  }).eq("dancer_id", dancerId).eq("status", "requested")
    .select("dancer_id, login_id, username, status, activated_at").single();
  if (error) throw error;
  await auditNatsAdminAction(client, adminUserId, "nats_affiliate_link_verified", "payout_account", dancerId, reason, {
    status: "active", login_id: account.login_id, username: account.username,
  });
  return data;
}

export async function disableNatsAffiliateLink(
  client: DancrClient,
  adminUserId: string,
  dancerId: string,
  reason: string,
) {
  const now = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_affiliate_accounts").update({
    status: "disabled", disabled_at: now, verification_note: reason, updated_at: now,
  }).eq("dancer_id", dancerId).in("status", ["requested", "active"])
    .select("dancer_id, login_id, username, status, disabled_at").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The NATS affiliate link is already disabled or was not found.");
  await auditNatsAdminAction(client, adminUserId, "nats_affiliate_link_disabled", "payout_account", dancerId, reason, { status: "disabled" });
  return data;
}

export async function reconcileNatsCommissionExport(
  client: DancrClient,
  adminUserId: string,
  exportId: string,
  resolution: "confirmed_exported" | "confirmed_not_exported",
  reason: string,
) {
  const { data: current, error: currentError } = await (client as any).from("nats_commission_exports")
    .select("id, status, commission_event_id, nats_result")
    .eq("id", exportId).maybeSingle();
  if (currentError) throw currentError;
  if (!current || current.status !== "reconciliation_required") {
    throw new Error("Only a NATS export requiring reconciliation can be resolved.");
  }
  const now = new Date().toISOString();
  const nextStatus = resolution === "confirmed_exported" ? "exported" : "pending";
  const { data, error } = await (client as any).from("nats_commission_exports").update({
    status: nextStatus,
    exported_at: resolution === "confirmed_exported" ? now : null,
    reconciled_at: now,
    nats_result: resolution === "confirmed_exported" ? `Admin confirmed in NATS: ${reason}` : null,
    last_error: null,
    failed_at: null,
    updated_at: now,
  }).eq("id", exportId).eq("status", "reconciliation_required")
    .select("id, status, commission_event_id, reconciled_at").single();
  if (error) throw error;
  await auditNatsAdminAction(client, adminUserId, "nats_commission_export_reconciled", "earning", exportId, reason, {
    status: nextStatus, resolution, commission_event_id: current.commission_event_id,
  });
  return data;
}

export async function retryFailedNatsCommissionExport(
  client: DancrClient,
  adminUserId: string,
  exportId: string,
  reason: string,
) {
  const now = new Date().toISOString();
  const { data, error } = await (client as any).from("nats_commission_exports").update({
    status: "pending", last_error: null, failed_at: null, reconciled_at: now, updated_at: now,
  }).eq("id", exportId).eq("status", "failed")
    .select("id, status, commission_event_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only a definitely rejected NATS export can be retried.");
  await auditNatsAdminAction(client, adminUserId, "nats_commission_export_retry_authorized", "earning", exportId, reason, {
    status: "pending", commission_event_id: data.commission_event_id,
  });
  return data;
}

async function auditNatsAdminAction(
  client: DancrClient,
  adminUserId: string,
  action: string,
  targetType: "earning" | "payout_account",
  targetId: string,
  reason: string,
  afterState: Record<string, unknown>,
) {
  const { error } = await (client as any).from("financial_audit_events").insert({
    actor_user_id: adminUserId,
    actor_type: "admin",
    action,
    target_type: targetType,
    target_id: targetId,
    reason,
    after_state: afterState,
    metadata: { commission_platform: "nats" },
  });
  if (error) throw error;
}
