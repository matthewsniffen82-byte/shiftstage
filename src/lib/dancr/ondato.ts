import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { evaluateOndatoDecision, jsonObject } from "./ondato-policy";
import { isOndatoId, ondatoHostedUrl } from "./ondato-url";

const unavailable = () => new PublicApiError("UNAVAILABLE", "Age verification is temporarily unavailable. Please try again later.", 503);
export function ondatoConfig() {
  const clientId = process.env.ONDATO_CLIENT_ID?.trim();
  const clientSecret = process.env.ONDATO_CLIENT_SECRET?.trim();
  const webhookSecret = process.env.ONDATO_WEBHOOK_SECRET?.trim();
  const setupId = process.env.ONDATO_SETUP_ID?.trim();
  const applicationId = process.env.ONDATO_APPLICATION_ID?.trim();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  // Ondato's production hosts also serve testing projects. Confirm a live
  // document + selfie/face-match/active-liveness setup before setting this flag.
  if (!clientId || !clientSecret || !webhookSecret || !isOndatoId(setupId) || !isOndatoId(applicationId)
    || !site || process.env.ONDATO_ENVIRONMENT !== "live") return null;
  try {
    const url = new URL(site);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { clientId, clientSecret, webhookSecret, setupId, applicationId,
      callback: new URL("/dashboard/dancer?age-verification=returned", url.origin).href };
  } catch { return null; }
}

async function readProviderJson(response: Response) {
  if (!response.ok) throw unavailable();
  const raw = await response.text();
  if (raw.length > 1_048_576) throw unavailable();
  return jsonObject(JSON.parse(raw));
}

async function providerClient(config: NonNullable<ReturnType<typeof ondatoConfig>>, timeoutMs: number) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const token = await readProviderJson(await fetch("https://id.ondato.com/connect/token", {
      method: "POST", cache: "no-store", redirect: "error", signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }),
    }));
    if (typeof token.access_token !== "string" || !token.access_token || token.token_type !== "Bearer") throw unavailable();
    return async (service: "idvapi" | "kycid", path: string, method = "GET", body?: Record<string, unknown>) => {
      try {
        const response = await fetch(`https://${service}.ondato.com${path}`, {
          method, cache: "no-store", redirect: "error", signal,
          headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (response.status === 204) return {};
        return await readProviderJson(response);
      } catch { throw unavailable(); }
    };
  } catch { throw unavailable(); }
}

export async function getDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const [settings, verification] = await Promise.all([
    admin.from("dancer_age_verification_settings").select("enabled").eq("singleton", true).single(),
    admin.from("dancer_age_verifications").select("status, verified_at").eq("user_id", userId).eq("provider", "ondato").maybeSingle(),
  ]);
  if (settings.error || verification.error) throw unavailable();
  return { required: settings.data.enabled === true, configured: Boolean(ondatoConfig()),
    status: verification.data?.status || "not_started", verifiedAt: verification.data?.verified_at || null };
}

export async function refreshDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("dancer_age_verifications").select("session_id, checked_at").eq("user_id", userId).eq("provider", "ondato").maybeSingle();
  if (error) throw unavailable();
  if (data?.session_id && (!data.checked_at || Date.now() - Date.parse(data.checked_at) > 10_000)) {
    await reconcileOndatoSession(admin, data.session_id);
  }
  return getDancerAgeVerification(admin, userId);
}

export async function startDancerAgeVerification(admin: SupabaseClient, userId: string) {
  const config = ondatoConfig();
  if (!config) throw unavailable();
  const { data: attempt, error } = await admin.rpc("reserve_dancer_age_verification", { p_user_id: userId, p_integration_id: config.setupId });
  if (error?.message?.includes("AGE_PROFILE_SETUP_REQUIRED")) throw new PublicApiError("FORBIDDEN", "Finish and submit your dancer profile before starting age verification.", 409);
  if (error?.message?.includes("AGE_VERIFICATION_RETRY_LIMIT")) throw new PublicApiError("FORBIDDEN", "You have reached today's verification limit. Please try again tomorrow or contact support.", 429);
  if (error || !isOndatoId(attempt?.attempt_id) || attempt.provider !== "ondato" || attempt.provider_integration_id !== config.setupId) throw unavailable();
  if (attempt.status === "verified" || attempt.status === "in_review") return { status: attempt.status, url: null };
  if (!attempt.reserved) {
    const url = ondatoHostedUrl(attempt.verification_url);
    if (!url || new URL(url).searchParams.get("id") !== attempt.session_id) throw new PublicApiError("CONFLICT", "Verification is starting. Please wait a moment and try again.", 409);
    return { status: "pending", url };
  }
  const request = await providerClient(config, 18_000);
  const session = await request("idvapi", "/v1/identity-verifications", "POST", {
    setupId: config.setupId, externalReferenceId: attempt.attempt_id,
  });
  if (!isOndatoId(session.id)) throw unavailable();
  await request("idvapi", `/v1/identity-verifications/${session.id}/setup-localisations`, "PUT", {
    defaultLanguage: "en-GB", localisationSettings: [{ language: "en-GB", pageTitle: "MyDancr age verification",
      successRedirectUrl: config.callback, failureRedirectUrl: config.callback, consentDeclinedRedirectUrl: config.callback }],
  });
  const url = `https://idv.ondato.com/?id=${session.id}`;
  const { data: saved, error: saveError } = await admin.from("dancer_age_verifications").update({
    session_id: session.id, status: "pending", verification_url: url,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  }).eq("user_id", userId).eq("provider", "ondato").eq("provider_integration_id", config.setupId)
    .eq("attempt_id", attempt.attempt_id).eq("status", "creating").select("session_id").maybeSingle();
  if (saveError || !saved) throw unavailable();
  return { status: "pending", url };
}

export async function reconcileOndatoSession(admin: SupabaseClient, sessionId: string, timeoutMs = 18_000) {
  if (!isOndatoId(sessionId)) return;
  const config = ondatoConfig();
  if (!config) throw unavailable();
  const { data: attempt, error } = await admin.from("dancer_age_verifications")
    .select("user_id, attempt_id, session_id, provider_integration_id, status, verified_at").eq("session_id", sessionId).eq("provider", "ondato").maybeSingle();
  if (error) throw unavailable();
  if (!attempt) return;
  if (attempt.provider_integration_id !== config.setupId) throw unavailable();
  const checkedAt = new Date().toISOString();
  const request = await providerClient(config, timeoutMs);
  const identity = await request("idvapi", `/v1/identity-verifications/${sessionId}`);
  if (identity.id !== sessionId || identity.externalReferenceId !== attempt.attempt_id
    || identity.applicationId !== config.applicationId || jsonObject(identity.setup).id !== config.setupId) throw unavailable();
  const kycStep = jsonObject(jsonObject(identity.step).kycIdentification);
  const kycId = kycStep.id;
  const identification = isOndatoId(kycId) ? await request("kycid", `/v1/identifications/${kycId}`) : null;
  // Read the setup attached to this identification, not the project's current
  // configuration. Rejections/expiry must still reconcile during setup outages.
  const identificationSetup = identification?.status === "Approved" && identity.status === "Completed" && kycStep.isSuccess === true
    ? await request("kycid", `/v1/identifications/${kycId}/setup`) : null;
  let status;
  try { status = evaluateOndatoDecision(identity, identification, identificationSetup, { sessionId, attemptId: attempt.attempt_id, setupId: config.setupId, applicationId: config.applicationId }); }
  catch { throw unavailable(); }
  const { error: saveError } = await admin.from("dancer_age_verifications").update({
    status, checked_at: checkedAt,
    verified_at: status === "verified" ? (attempt.status === "verified" && attempt.verified_at ? attempt.verified_at : checkedAt) : null,
    ...(status === "verified" || status === "declined" || status === "expired" ? { verification_url: null } : {}),
  }).eq("user_id", attempt.user_id).eq("provider", "ondato").eq("provider_integration_id", config.setupId)
    .eq("attempt_id", attempt.attempt_id).eq("session_id", sessionId)
    .or(`checked_at.is.null,checked_at.lt.${checkedAt}`);
  if (saveError) throw unavailable();
}
