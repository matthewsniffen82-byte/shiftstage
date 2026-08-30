import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountRecoveryRole = "customer" | "dancer" | "venue" | "admin";
export type AccountRecoveryEventType = "password_reset" | "email_lookup" | "venue_access_preview";

export class AccountRecoveryRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many account recovery requests. Please wait and try again.");
    this.name = "AccountRecoveryRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function accountRecoveryRequestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || `unknown:${request.headers.get("user-agent")?.slice(0, 160) || "client"}`
  );
}

export async function enforceAccountRecoveryRateLimit(client: SupabaseClient, input: {
  eventType: AccountRecoveryEventType;
  role: AccountRecoveryRole;
  request: Request;
  subject: string;
}) {
  const limits = input.eventType === "password_reset"
    ? { windowSeconds: 15 * 60, ipLimit: 8, subjectLimit: 3 }
    : input.eventType === "venue_access_preview"
      ? { windowSeconds: 10 * 60, ipLimit: 20, subjectLimit: 6 }
      : { windowSeconds: 60 * 60, ipLimit: 4, subjectLimit: 2 };
  const requestIpHash = recoveryHash(`ip:${accountRecoveryRequestIp(input.request)}`);
  const subjectHash = recoveryHash(`subject:${input.eventType}:${input.subject.trim().toLowerCase()}`);
  if (input.eventType === "venue_access_preview") {
    await enforceCompatibilityRateLimit(client, {
      ...input,
      ...limits,
      requestIpHash,
      subjectHash,
    });
    return;
  }
  const { data, error } = await client.rpc("record_account_recovery_event", {
    p_event_type: input.eventType,
    p_role: input.role,
    p_request_ip_hash: requestIpHash,
    p_subject_hash: subjectHash,
    p_window_seconds: limits.windowSeconds,
    p_ip_limit: limits.ipLimit,
    p_subject_limit: limits.subjectLimit,
  });

  if (error && isMissingRecoveryRateLimitFunction(error)) {
    await enforceCompatibilityRateLimit(client, {
      ...input,
      ...limits,
      requestIpHash,
      subjectHash,
    });
    return;
  }
  if (error) throw error;
  if (data !== true) throw new AccountRecoveryRateLimitError(limits.windowSeconds);
}

async function enforceCompatibilityRateLimit(client: SupabaseClient, input: {
  eventType: AccountRecoveryEventType;
  role: AccountRecoveryRole;
  windowSeconds: number;
  ipLimit: number;
  subjectLimit: number;
  requestIpHash: string;
  subjectHash: string;
}) {
  const since = new Date(Date.now() - input.windowSeconds * 1000).toISOString();
  const ipTargetType = `account_recovery_${input.eventType}_ip`;
  const subjectTargetType = `account_recovery_${input.eventType}_subject`;
  const ipTargetId = hashUuid(input.requestIpHash);
  const subjectTargetId = hashUuid(input.subjectHash);
  const [ipResult, subjectResult] = await Promise.all([
    (client as any)
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("target_type", ipTargetType)
      .eq("target_id", ipTargetId)
      .eq("status", "resolved")
      .gte("created_at", since),
    (client as any)
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("target_type", subjectTargetType)
      .eq("target_id", subjectTargetId)
      .eq("status", "resolved")
      .gte("created_at", since),
  ]);

  if (ipResult.error) throw ipResult.error;
  if (subjectResult.error) throw subjectResult.error;
  if ((ipResult.count || 0) >= input.ipLimit || (subjectResult.count || 0) >= input.subjectLimit) {
    throw new AccountRecoveryRateLimitError(input.windowSeconds);
  }

  const { error } = await (client as any).from("content_reports").insert([
    internalThrottleRecord(ipTargetType, ipTargetId, input.role),
    internalThrottleRecord(subjectTargetType, subjectTargetId, input.role),
  ]);
  if (error) throw error;

  console.warn(JSON.stringify({ event: "account_recovery.compatibility_rate_limit_used", eventType: input.eventType }));
}

function internalThrottleRecord(targetType: string, targetId: string, role: AccountRecoveryRole) {
  return {
    reporter_id: null,
    target_type: targetType,
    target_id: targetId,
    target_label: "Internal account-recovery throttle record",
    reason: role,
    details: null,
    status: "resolved",
  };
}

function hashUuid(hash: string) {
  const value = hash.slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function isMissingRecoveryRateLimitFunction(error: { code?: string; message?: string }) {
  return error.code === "PGRST202"
    || /record_account_recovery_event.*(schema cache|could not find|does not exist)/i.test(error.message || "");
}

function recoveryHash(value: string) {
  const secret = process.env.DANCR_ACCOUNT_RECOVERY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Account recovery security is not configured.");
  return createHmac("sha256", secret).update(value).digest("hex");
}
