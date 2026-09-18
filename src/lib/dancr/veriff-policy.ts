import { createHmac, timingSafeEqual } from "node:crypto";

type JsonObject = Record<string, unknown>;
export type AgeVerificationStatus = "not_started" | "creating" | "pending" | "in_review" | "verified" | "declined" | "expired";
export const jsonObject = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
export const isVeriffId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const signVeriff = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("hex");

export function verifyVeriffPayload(raw: string, headers: Headers, config: { apiKey: string; sharedSecret: string; integrationId: string }): JsonObject | null {
  const client = headers.get("x-auth-client") || headers.get("vrf-auth-client");
  const signature = headers.get("x-hmac-signature") || headers.get("vrf-hmac-signature");
  if (!config.apiKey || !config.sharedSecret || client !== config.apiKey || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  // Reject conflicting old/new headers and responses from a different integration.
  if (["x-auth-client", "vrf-auth-client"].some(key => headers.has(key) && headers.get(key) !== config.apiKey)
    || ["x-hmac-signature", "vrf-hmac-signature"].some(key => headers.has(key) && headers.get(key)?.toLowerCase() !== signature.toLowerCase())
    || (headers.has("vrf-integration-id") && headers.get("vrf-integration-id") !== config.integrationId)) return null;
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signVeriff(raw, config.sharedSecret), "hex"))) return null;
  try {
    const payload = JSON.parse(raw);
    return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch { return null; }
}

export function isAdultDateOfBirth(value: unknown, now = new Date()): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const birth = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== value || birth > now) return false;
  const years = now.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayReached = now.getUTCMonth() > birth.getUTCMonth()
    || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  const age = years - (birthdayReached ? 0 : 1);
  return age >= 18 && age <= 120;
}

export function evaluateVeriffDecision(value: unknown, expected: { sessionId: string; attemptId: string }, now = new Date()): AgeVerificationStatus | null {
  const payload = jsonObject(value);
  if (payload.status !== "success") throw new Error("VERIFF_DECISION_INVALID");
  // Veriff has no decision yet. Do not revoke or overwrite a saved result.
  if (payload.verification === null) return null;
  const decision = jsonObject(payload.verification);
  if (decision.id !== expected.sessionId || decision.vendorData !== expected.attemptId
    || payload.environment === "test" || payload.environment === "sandbox") throw new Error("VERIFF_DECISION_MISMATCH");
  if (decision.status === "declined" && decision.code === 9102) return "declined";
  if ((decision.status === "expired" && decision.code === 9104) || (decision.status === "abandoned" && decision.code === 9121)) return "expired";
  // A resubmission reuses the existing hosted session, not another paid session.
  if (decision.status === "resubmission_requested" && decision.code === 9103) return "pending";
  if (decision.status !== "approved" || decision.code !== 9001) return "in_review";
  const document = jsonObject(decision.document);
  const dob = jsonObject(decision.person).dateOfBirth;
  // The configured integration must require ID + selfie/liveness. The standard
  // decision combines those checks; it does not return individual module results.
  if (!["PASSPORT", "ID_CARD", "DRIVERS_LICENSE", "RESIDENCE_PERMIT"].includes(String(document.type))
    || !isVeriffId(decision.attemptId) || typeof decision.decisionTime !== "string"
    || !Number.isFinite(Date.parse(decision.decisionTime)) || Date.parse(decision.decisionTime) > now.getTime() + 300_000) return "in_review";
  return isAdultDateOfBirth(dob, now) ? "verified" : "declined";
}
