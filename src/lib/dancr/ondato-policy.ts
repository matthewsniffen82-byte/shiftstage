import { createHmac, timingSafeEqual } from "node:crypto";
import { isOndatoId } from "./ondato-url.ts";

type JsonObject = Record<string, unknown>;
export type AgeVerificationStatus = "not_started" | "creating" | "pending" | "in_review" | "verified" | "declined" | "expired";
export const jsonObject = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

export function verifyOndatoPayload(raw: string, headers: Headers, config: { webhookSecret: string; applicationId: string }, now = Date.now()): JsonObject | null {
  const signature = headers.get("ondato-signature")?.match(/^t=(\d{10}),\s*s=([a-f0-9]{64})$/i);
  if (!signature || !config.webhookSecret) return null;
  const age = now - Number(signature[1]) * 1000;
  // Ondato retries for up to 24 hours. Always retrieve the current result;
  // a delayed or replayed notification is never itself an approval.
  if (age < -300_000 || age > 25 * 60 * 60 * 1000) return null;
  const expected = createHmac("sha256", config.webhookSecret).update(`${signature[1]}.${raw}`).digest();
  if (!timingSafeEqual(Buffer.from(signature[2], "hex"), expected)) return null;
  try {
    const event = jsonObject(JSON.parse(raw));
    return event.applicationId === config.applicationId && isOndatoId(event.id) ? event : null;
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

export function evaluateOndatoDecision(identity: unknown, identification: unknown, expected: {
  sessionId: string; attemptId: string; setupId: string; applicationId: string;
}, now = new Date()): AgeVerificationStatus {
  const idv = jsonObject(identity);
  if (idv.id !== expected.sessionId || idv.externalReferenceId !== expected.attemptId
    || idv.applicationId !== expected.applicationId || jsonObject(idv.setup).id !== expected.setupId) {
    throw new Error("ONDATO_DECISION_MISMATCH");
  }
  if (idv.status === "Expired" || idv.status === "Aborted") return "expired";
  const step = jsonObject(jsonObject(idv.step).kycIdentification);
  if (!isOndatoId(step.id)) return idv.status === "Pending" || idv.status === "InProgress" ? "pending" : "in_review";
  const kyc = jsonObject(identification);
  if (kyc.id !== step.id || kyc.identityVerificationId !== expected.sessionId
    || kyc.applicationId !== expected.applicationId || kyc.externalReferenceId !== expected.attemptId) {
    throw new Error("ONDATO_DECISION_MISMATCH");
  }
  if (kyc.status === "Rejected") return "declined";
  if (idv.status !== "Completed" || kyc.status !== "Approved" || step.isSuccess === false) return "in_review";
  const document = jsonObject(kyc.document);
  if (!["Passport", "IdCard", "DriverLicense", "ResidencePermit"].includes(String(document.type))
    || typeof kyc.completedUtc !== "string" || !Number.isFinite(Date.parse(kyc.completedUtc))
    || Date.parse(kyc.completedUtc) > now.getTime() + 300_000) return "in_review";
  if (!isAdultDateOfBirth(document.dateOfBirth, now)) return "declined";
  const rules = Array.isArray(kyc.rules) ? kyc.rules.map(jsonObject) : [];
  // Require the configured document + passive-liveness flow, never age estimation alone.
  if (rules.some(rule => rule.status === "Fail") || ![
    "SelfieHasFace", "DocumentHasFace", "SelfieAndDocumentFacesMatch", "SuccessfulPassiveLivenessCheck",
  ].every(name => rules.some(rule => rule.name === name && rule.status === "Success"))) return "in_review";
  return "verified";
}
