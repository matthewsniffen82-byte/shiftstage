import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { getOptionalServerEnv } from "@/src/lib/env";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

const YOTI_AGE_API_BASE_URL = "https://age.yoti.com/api/v1";
const YOTI_WEB_URL = "https://age.yoti.com";
const REQUEST_TIMEOUT_MS = 12_000;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MINUTES = 15;
const AUDIT_RETENTION_DAYS = 90;

type YotiStatus = "PENDING" | "IN_PROGRESS" | "FAIL" | "COMPLETE" | "ERROR" | "CANCELLED" | string;

type YotiSessionResult = {
  id?: string;
  sdk_id?: string;
  type?: string;
  age?: number;
  status?: YotiStatus;
  method?: string;
  reference_id?: string;
  expires_at?: string;
};

export class YotiAgeVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "YotiAgeVerificationError";
  }
}

export function getYotiAgeVerificationPublicState() {
  const enabled = process.env.YOTI_AGE_VERIFICATION_ENABLED?.trim().toLowerCase() === "true";
  const configured = Boolean(
    getOptionalServerEnv("YOTI_AGE_API_KEY")
    && getOptionalServerEnv("YOTI_AGE_SDK_ID")
    && (getOptionalServerEnv("YOTI_AGE_COOKIE_SECRET")?.length || 0) >= 32,
  );
  return { enabled, configured };
}

export async function createYotiAgeVerificationSession(request: Request, requestedReturnTo: unknown) {
  const config = getYotiConfig();
  const returnTo = safeReturnTo(requestedReturnTo);
  const clientFingerprintHash = requestFingerprintHash(request, config.fingerprintSecret);
  const db = createAdminSupabaseClient() as any;
  const referenceId = randomUUID();
  const now = new Date();

  await db
    .from("age_verification_sessions")
    .delete()
    .lt("purge_after", now.toISOString());

  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error: countError } = await db
    .from("age_verification_sessions")
    .select("id", { count: "exact", head: true })
    .eq("client_fingerprint_hash", clientFingerprintHash)
    .gte("created_at", windowStart);
  if (countError) throw databaseError(countError, "Could not check age-verification attempt limits.");
  if ((count || 0) >= ATTEMPT_LIMIT) {
    throw new YotiAgeVerificationError(
      "Too many verification attempts. Please wait 15 minutes and try again.",
      "rate_limited",
      429,
    );
  }

  const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1_000);
  const { error: insertError } = await db.from("age_verification_sessions").insert({
    reference_id: referenceId,
    client_fingerprint_hash: clientFingerprintHash,
    status: "pending",
    provider_status: "CREATING",
    minimum_age: config.minimumAge,
    expires_at: expiresAt.toISOString(),
    purge_after: new Date(now.getTime() + AUDIT_RETENTION_DAYS * 86_400_000).toISOString(),
  });
  if (insertError) throw databaseError(insertError, "Could not create the age-verification audit record.");

  const callbackUrl = new URL("/age-verification/callback", config.siteUrl);
  callbackUrl.searchParams.set("returnTo", returnTo);
  const cancelUrl = new URL("/age-verification", config.siteUrl);
  cancelUrl.searchParams.set("state", "cancelled");
  cancelUrl.searchParams.set("returnTo", returnTo);

  try {
    const session = await yotiRequest<{ id?: string; expires_at?: string }>(
      "/sessions",
      config,
      {
        method: "POST",
        body: JSON.stringify({
          type: "OVER",
          ttl: config.sessionTtlSeconds,
          age_estimation: {
            allowed: true,
            threshold: config.estimationThreshold,
            level: "PASSIVE",
            retry_limit: 2,
          },
          digital_id: {
            allowed: true,
            threshold: config.minimumAge,
            age_estimation_allowed: true,
            age_estimation_threshold: config.estimationThreshold,
            retry_limit: 2,
          },
          doc_scan: {
            allowed: true,
            threshold: config.minimumAge,
            authenticity: "AUTO",
            level: "PASSIVE",
            retry_limit: 2,
          },
          credit_card: { allowed: false },
          mobile: { allowed: false },
          reference_id: referenceId,
          callback: { auto: true, url: callbackUrl.toString() },
          cancel_url: cancelUrl.toString(),
          retry_enabled: true,
          resume_enabled: true,
          synchronous_checks: true,
        }),
      },
    );
    if (!session.id || !isUuid(session.id)) {
      throw new YotiAgeVerificationError("Yoti returned an invalid session.", "invalid_provider_response", 502);
    }

    const { error: updateError } = await db
      .from("age_verification_sessions")
      .update({
        yoti_session_id_hash: hashYotiSessionId(session.id),
        provider_status: "PENDING",
        expires_at: validIsoTimestamp(session.expires_at) || expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("reference_id", referenceId);
    if (updateError) throw databaseError(updateError, "Could not secure the Yoti session record.");

    const sessionUrl = new URL(YOTI_WEB_URL);
    sessionUrl.searchParams.set("sessionId", session.id);
    sessionUrl.searchParams.set("sdkId", config.sdkId);
    return { sessionUrl: sessionUrl.toString() };
  } catch (error) {
    await db
      .from("age_verification_sessions")
      .update({
        status: "error",
        provider_status: "ERROR",
        failure_code: error instanceof YotiAgeVerificationError ? error.code : "provider_error",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("reference_id", referenceId);
    throw error;
  }
}

export async function finalizeYotiAgeVerification(sessionId: string) {
  if (!isUuid(sessionId)) {
    throw new YotiAgeVerificationError("Invalid verification session.", "invalid_session", 400);
  }
  const config = getYotiConfig();
  const db = createAdminSupabaseClient() as any;
  const sessionHash = hashYotiSessionId(sessionId);
  const { data: attempt, error: attemptError } = await db
    .from("age_verification_sessions")
    .select("id, reference_id, status, expires_at")
    .eq("yoti_session_id_hash", sessionHash)
    .maybeSingle();
  if (attemptError) throw databaseError(attemptError, "Could not retrieve the verification attempt.");
  if (!attempt) throw new YotiAgeVerificationError("Verification session not found.", "session_not_found", 404);
  if (attempt.status === "passed") return { state: "passed" as const, referenceId: attempt.reference_id };
  if (["failed", "cancelled", "expired"].includes(attempt.status)) {
    return { state: attempt.status as "failed" | "cancelled" | "expired" };
  }
  if (Date.parse(attempt.expires_at) <= Date.now()) {
    await markAttempt(db, attempt.id, "expired", "EXPIRED", null, "session_expired");
    return { state: "expired" as const };
  }

  const result = await yotiRequest<YotiSessionResult>(`/sessions/${encodeURIComponent(sessionId)}/result`, config);
  if (
    result.id !== sessionId
    || result.sdk_id !== config.sdkId
    || result.reference_id !== attempt.reference_id
    || result.type !== "OVER"
  ) {
    await markAttempt(db, attempt.id, "error", String(result.status || "INVALID"), null, "result_mismatch");
    throw new YotiAgeVerificationError("Yoti result validation failed.", "result_mismatch", 502);
  }

  const providerStatus = String(result.status || "UNKNOWN").toUpperCase();
  if (providerStatus === "PENDING" || providerStatus === "IN_PROGRESS") {
    await markAttempt(db, attempt.id, "pending", providerStatus);
    return { state: "processing" as const };
  }
  if (providerStatus === "COMPLETE" && Number.isInteger(result.age) && Number(result.age) >= config.minimumAge) {
    await markAttempt(db, attempt.id, "passed", providerStatus, result.method || null);
    return { state: "passed" as const, referenceId: attempt.reference_id };
  }

  const state = providerStatus === "CANCELLED" ? "cancelled" : providerStatus === "FAIL" ? "failed" : "error";
  await markAttempt(db, attempt.id, state, providerStatus, result.method || null, `provider_${providerStatus.toLowerCase()}`);
  return { state: state as "failed" | "cancelled" | "error" };
}

export function yotiAgeCookieSecret() {
  const secret = getOptionalServerEnv("YOTI_AGE_COOKIE_SECRET");
  if (!secret || secret.length < 32) {
    throw new YotiAgeVerificationError("Age verification is not configured.", "configuration_error", 503);
  }
  return secret;
}

export function safeReturnTo(value: unknown) {
  if (typeof value !== "string") return "/";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.startsWith("/age-verification")) {
    return "/";
  }
  return path.slice(0, 2_000);
}

function getYotiConfig() {
  const publicState = getYotiAgeVerificationPublicState();
  if (!publicState.enabled || !publicState.configured) {
    throw new YotiAgeVerificationError("Age verification is not configured.", "configuration_error", 503);
  }
  const siteUrl = getOptionalServerEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000";
  if (process.env.NODE_ENV === "production" && !siteUrl.startsWith("https://")) {
    throw new YotiAgeVerificationError("The production site URL must use HTTPS.", "configuration_error", 503);
  }

  const minimumAge = boundedInteger(process.env.YOTI_AGE_MINIMUM_AGE, 18, 18, 99);
  return {
    apiKey: getOptionalServerEnv("YOTI_AGE_API_KEY")!,
    sdkId: getOptionalServerEnv("YOTI_AGE_SDK_ID")!,
    siteUrl,
    minimumAge,
    estimationThreshold: boundedInteger(process.env.YOTI_AGE_ESTIMATION_THRESHOLD, 25, minimumAge, 99),
    sessionTtlSeconds: boundedInteger(process.env.YOTI_AGE_SESSION_TTL_SECONDS, 900, 60, 2_592_000),
    fingerprintSecret: getOptionalServerEnv("DANCR_IP_HASH_SECRET") || getOptionalServerEnv("YOTI_AGE_COOKIE_SECRET")!,
  };
}

async function yotiRequest<T>(path: string, config: ReturnType<typeof getYotiConfig>, init: RequestInit = {}) {
  const response = await fetch(`${YOTI_AGE_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Yoti-SDK-Id": config.sdkId,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error("Yoti Age API request failed", { path, status: response.status });
    throw new YotiAgeVerificationError("Yoti could not start or complete verification.", "provider_error", 502);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new YotiAgeVerificationError("Yoti returned an invalid response.", "invalid_provider_response", 502);
  }
}

async function markAttempt(
  db: any,
  id: string,
  status: string,
  providerStatus: string,
  method: string | null = null,
  failureCode: string | null = null,
) {
  const final = status !== "pending";
  const { error } = await db.from("age_verification_sessions").update({
    status,
    provider_status: providerStatus,
    method,
    failure_code: failureCode,
    completed_at: final ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw databaseError(error, "Could not update the age-verification audit record.");
}

function requestFingerprintHash(request: Request, secret: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("cf-connecting-ip") || "unknown";
  const agent = request.headers.get("user-agent")?.slice(0, 256) || "unknown";
  return createHmac("sha256", secret).update(`${address}\n${agent}`).digest("hex");
}

function hashYotiSessionId(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

function databaseError(error: { message?: string }, message: string) {
  console.error(message, { databaseMessage: error.message || "Unknown database error" });
  return new YotiAgeVerificationError(message, "database_error", 503);
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function validIsoTimestamp(value: string | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
