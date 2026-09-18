import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { evaluateVeriffDecision, isVeriffId, jsonObject, signVeriff, verifyVeriffPayload } from "./veriff-policy";
import { veriffApiUrl, veriffHostedUrl } from "./veriff-url";

const unavailable = () => new PublicApiError("UNAVAILABLE", "Age verification is temporarily unavailable. Please try again later.", 503);
export function veriffConfig() {
  const apiKey = process.env.VERIFF_API_KEY?.trim();
  const sharedSecret = process.env.VERIFF_SHARED_SECRET?.trim();
  const integrationId = process.env.VERIFF_INTEGRATION_ID?.trim();
  const baseUrl = veriffApiUrl(process.env.VERIFF_BASE_URL?.trim());
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  // Only credentials confirmed as a live ID + selfie integration belong here.
  if (!apiKey || !sharedSecret || !isVeriffId(integrationId) || !baseUrl || !site || process.env.VERIFF_ENVIRONMENT !== "live") return null;
  try {
    const url = new URL(site);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { apiKey, sharedSecret, integrationId, baseUrl, callback: new URL("/dashboard/dancer?age-verification=returned", url.origin).href };
  } catch { return null; }
}

async function veriffRequest(config: NonNullable<ReturnType<typeof veriffConfig>>, sessionId?: string, body?: Record<string, unknown>, timeoutMs = 15_000) {
  try {
    const rawBody = body ? JSON.stringify(body) : undefined;
    const response = await fetch(`${config.baseUrl}/v1/sessions${sessionId ? `/${sessionId}/decision` : ""}`, {
      method: rawBody ? "POST" : "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-auth-client": config.apiKey, "x-hmac-signature": signVeriff(rawBody || sessionId || "", config.sharedSecret), "content-type": "application/json" },
      ...(rawBody ? { body: rawBody } : {}),
    });
    if (!response.ok) throw unavailable();
    const raw = await response.text();
    if (raw.length > 1_048_576) throw unavailable();
    const payload = verifyVeriffPayload(raw, response.headers, config);
    if (!payload || payload.status !== "success") throw unavailable();
    return payload;
  } catch { throw unavailable(); }
}

export async function getDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const [settings, verification] = await Promise.all([
    admin.from("dancer_age_verification_settings").select("enabled").eq("singleton", true).single(),
    admin.from("dancer_age_verifications").select("status, verified_at").eq("user_id", userId).eq("provider", "veriff").maybeSingle(),
  ]);
  if (settings.error || verification.error) throw unavailable();
  return { required: settings.data.enabled === true, configured: Boolean(veriffConfig()),
    status: verification.data?.status || "not_started", verifiedAt: verification.data?.verified_at || null };
}

export async function refreshDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("dancer_age_verifications").select("session_id, checked_at").eq("user_id", userId).eq("provider", "veriff").maybeSingle();
  if (error) throw unavailable();
  if (data?.session_id && (!data.checked_at || Date.now() - Date.parse(data.checked_at) > 10_000)) {
    await reconcileVeriffSession(admin, data.session_id);
  }
  return getDancerAgeVerification(admin, userId);
}

export async function startDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const config = veriffConfig();
  if (!config) throw unavailable();
  const { data: attempt, error } = await admin.rpc("reserve_dancer_age_verification", { p_user_id: userId, p_integration_id: config.integrationId });
  if (error?.message?.includes("AGE_VERIFICATION_RETRY_LIMIT")) throw new PublicApiError("FORBIDDEN", "You have reached today's verification limit. Please try again tomorrow or contact support.", 429);
  if (error || !attempt?.attempt_id || attempt.provider !== "veriff") throw unavailable();
  if (attempt.status === "verified") return { status: attempt.status, url: null };
  if (attempt.provider_integration_id !== config.integrationId) throw unavailable();
  if (attempt.status === "in_review") return { status: attempt.status, url: null };
  if (!attempt.reserved) {
    const url = veriffHostedUrl(attempt.verification_url);
    if (!url) throw new PublicApiError("CONFLICT", "Verification is starting. Please wait a moment and try again.", 409);
    return { status: "pending", url };
  }
  const response = await veriffRequest(config, undefined, { verification: {
    callback: config.callback, vendorData: attempt.attempt_id,
  } });
  const session = jsonObject(response.verification);
  const url = veriffHostedUrl(session.url);
  if (!isVeriffId(session.id) || !url || session.vendorData !== attempt.attempt_id || session.status !== "created") throw unavailable();
  const { data: saved, error: saveError } = await admin.from("dancer_age_verifications").update({
    session_id: session.id, status: "pending", verification_url: url,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  }).eq("user_id", userId).eq("provider", "veriff").eq("provider_integration_id", config.integrationId)
    .eq("attempt_id", attempt.attempt_id).eq("status", "creating").select("session_id").maybeSingle();
  if (saveError || !saved) throw unavailable();
  return { status: "pending", url };
}

export async function reconcileVeriffSession(admin: SupabaseClient, sessionId: string, timeoutMs = 15_000) {
  if (!isVeriffId(sessionId)) return;
  const config = veriffConfig();
  if (!config) throw unavailable();
  const { data: attempt, error } = await admin.from("dancer_age_verifications")
    .select("user_id, attempt_id, session_id, provider_integration_id").eq("session_id", sessionId).eq("provider", "veriff").maybeSingle();
  if (error) throw unavailable();
  // Ignore unknown, retired-provider and superseded sessions.
  if (!attempt) return;
  if (attempt.provider_integration_id !== config.integrationId) throw unavailable();
  const checkedAt = new Date().toISOString();
  const decision = await veriffRequest(config, sessionId, undefined, timeoutMs);
  let status;
  try { status = evaluateVeriffDecision(decision, { sessionId, attemptId: attempt.attempt_id }); }
  catch { throw unavailable(); }
  if (status === null) return;
  const { error: saveError } = await admin.from("dancer_age_verifications").update({
    status, checked_at: checkedAt, verified_at: status === "verified" ? checkedAt : null,
    ...(status === "verified" || status === "declined" || status === "expired" ? { verification_url: null } : {}),
  }).eq("user_id", attempt.user_id).eq("provider", "veriff").eq("provider_integration_id", config.integrationId)
    .eq("attempt_id", attempt.attempt_id).eq("session_id", sessionId)
    .or(`checked_at.is.null,checked_at.lt.${checkedAt}`);
  if (saveError) throw unavailable();
}
