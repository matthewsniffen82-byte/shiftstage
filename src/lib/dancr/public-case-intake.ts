import { PublicApiError } from "../api-error-policy.ts";

export const SAFETY_REASONS = ["Nonconsensual intimate image", "Underage concern", "Trafficking or immediate safety concern", "Sexual or unsafe content", "Harassment or abuse", "Impersonation", "Spam or misleading content", "Other safety concern"] as const;
export const PRIVACY_RIGHTS = ["Access or portable copy", "Delete my information", "Correct my information", "Opt out of sale or sharing", "Limit sensitive information use", "Withdraw consent", "Review a score or decision", "Privacy appeal", "Other privacy request"] as const;
export type SafetyDetails = { reason: string; details: string; contactEmail: string; contentLocation: string; requestedAction: string; signature: string; authority: string; goodFaith: boolean };
const invalid = (message: string): never => { throw new PublicApiError("INVALID_REQUEST", message, 400); };
function text(body: Record<string, unknown>, key: string, max: number, required = false) {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (value.length > max) invalid(`${key} is too long.`);
  if (required && !value) invalid(`Please complete ${key}.`);
  return value;
}
function email(body: Record<string, unknown>, required: boolean) {
  const value = text(body, "contactEmail", 254, required);
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid("Enter a valid contact email.");
  return value;
}
export function safetyIntake(body: Record<string, unknown>, hasTarget: boolean) {
  const reason = text(body, "reason", 120, true);
  const intimate = reason === SAFETY_REASONS[0];
  const intake = {
    contactEmail: email(body, intimate),
    contentLocation: text(body, "contentLocation", 1500, !hasTarget),
    requestedAction: text(body, "requestedAction", 1000, intimate),
    signature: text(body, "signature", 160, intimate),
    authority: text(body, "authority", 1000, intimate),
    goodFaith: body.goodFaith === true,
  };
  if (intimate && !intake.goodFaith) invalid("Confirm your good-faith statement for an intimate-image removal request.");
  return { intake, case_kind: "safety", priority: intimate || /Underage|Trafficking/.test(reason) ? "urgent" : "normal" };
}
export function privacyIntake(body: Record<string, unknown>) {
  const right = text(body, "right", 120, true);
  if (!(PRIVACY_RIGHTS as readonly string[]).includes(right)) invalid("Choose a privacy request type.");
  return {
    right, contactEmail: email(body, true),
    jurisdiction: text(body, "jurisdiction", 160, true),
    authority: text(body, "authority", 1000, true),
    details: text(body, "details", 2000, true),
    previousReference: text(body, "previousReference", 100),
    verificationStatus: /Opt out|Limit sensitive/.test(right) ? "not_required" : "not_started",
  };
}
