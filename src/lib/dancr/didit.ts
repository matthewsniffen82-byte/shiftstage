import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { diditHostedUrl, evaluateDiditDecision, isDiditSessionId } from "./didit-policy";

const unavailable = () => new PublicApiError("UNAVAILABLE", "Age verification is temporarily unavailable. Please try again later.", 503);
export function diditConfig() {
  const apiKey = process.env.DIDIT_API_KEY?.trim();
  const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim();
  const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET?.trim();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!apiKey || !workflowId || !webhookSecret || !site) return null;
  const url = new URL(site);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return { apiKey, workflowId, webhookSecret, callback: new URL("/dashboard/dancer?age-verification=returned", url.origin).href };
}

async function diditRequest(path: string, body?: Record<string, unknown>) {
  const config = diditConfig();
  if (!config) throw unavailable();
  try {
    const response = await fetch(`https://verification.didit.me/v3/${path}`, {
      method: body ? "POST" : "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "x-api-key": config.apiKey, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw unavailable();
    // Provider responses contain identity data. Never log or persist the raw payload.
    return await response.json();
  } catch { throw unavailable(); }
}

export async function getDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const [settings, verification] = await Promise.all([
    admin.from("dancer_age_verification_settings").select("enabled").eq("singleton", true).single(),
    admin.from("dancer_age_verifications").select("status, verified_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (settings.error || verification.error) throw unavailable();
  return { required: settings.data.enabled === true, configured: Boolean(diditConfig()),
    status: verification.data?.status || "not_started", verifiedAt: verification.data?.verified_at || null };
}

export async function refreshDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("dancer_age_verifications").select("session_id, checked_at").eq("user_id", userId).maybeSingle();
  if (error) throw unavailable();
  if (data?.session_id && (!data.checked_at || Date.now() - Date.parse(data.checked_at) > 10_000)) {
    await reconcileDiditSession(admin, data.session_id);
  }
  return getDancerAgeVerification(admin, userId);
}

export async function startDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const config = diditConfig();
  if (!config) throw unavailable();
  const { data: attempt, error } = await admin.rpc("reserve_dancer_age_verification", { p_user_id: userId });
  if (error?.message?.includes("AGE_VERIFICATION_RETRY_LIMIT")) throw new PublicApiError("FORBIDDEN", "You have reached today's verification limit. Please try again tomorrow or contact support.", 429);
  if (error || !attempt?.attempt_id) throw unavailable();
  if (attempt.status === "verified" || attempt.status === "in_review") return { status: attempt.status, url: null };
  if (!attempt.reserved) {
    const url = diditHostedUrl(attempt.verification_url);
    if (!url) throw new PublicApiError("CONFLICT", "Verification is starting. Please wait a moment and try again.", 409);
    return { status: "pending", url };
  }
  const session = await diditRequest("session/", {
    workflow_id: config.workflowId, vendor_data: attempt.attempt_id, callback: config.callback,
    language: "en",
  });
  const url = diditHostedUrl(session.url);
  if (!isDiditSessionId(session.session_id) || !url || session.workflow_id !== config.workflowId
    || session.vendor_data !== attempt.attempt_id || (session.session_kind && session.session_kind !== "user")
    || session.environment === "sandbox" || session.sandbox_scenario) throw unavailable();
  const { data: saved, error: saveError } = await admin.from("dancer_age_verifications").update({
    session_id: session.session_id, workflow_id: config.workflowId, status: "pending", verification_url: url,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  }).eq("user_id", userId).eq("attempt_id", attempt.attempt_id).eq("status", "creating").select("session_id").maybeSingle();
  if (saveError || !saved) throw unavailable();
  return { status: "pending", url };
}

export async function reconcileDiditSession(admin: SupabaseClient, sessionId: string) {
  if (!isDiditSessionId(sessionId)) return;
  const { data: attempt, error } = await admin.from("dancer_age_verifications")
    .select("user_id, attempt_id, session_id, workflow_id").eq("session_id", sessionId).maybeSingle();
  if (error) throw unavailable();
  // Unknown, deleted and superseded sessions can never authorize an account.
  if (!attempt) return;
  const checkedAt = new Date().toISOString();
  const decision = await diditRequest(`session/${sessionId}/decision/`);
  let status;
  try { status = evaluateDiditDecision(decision, { sessionId, workflowId: attempt.workflow_id, attemptId: attempt.attempt_id }); }
  catch { throw unavailable(); }
  const { error: saveError } = await admin.from("dancer_age_verifications").update({
    status, checked_at: checkedAt, verified_at: status === "verified" ? checkedAt : null,
    ...(status === "verified" || status === "declined" ? { verification_url: null } : {}),
  }).eq("user_id", attempt.user_id).eq("attempt_id", attempt.attempt_id).eq("session_id", sessionId)
    .or(`checked_at.is.null,checked_at.lt.${checkedAt}`);
  if (saveError) throw unavailable();
}
