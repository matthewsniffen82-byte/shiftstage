import { getOptionalServerEnv } from "../env";

export const IDENTITY_VERIFICATION_MODES = ["auto_approve", "verifymy"] as const;

export type IdentityVerificationMode = (typeof IDENTITY_VERIFICATION_MODES)[number];

export function getIdentityVerificationMode(): IdentityVerificationMode {
  const configured = getOptionalServerEnv("DANCR_IDENTITY_VERIFICATION_MODE")?.toLowerCase();
  if (!configured) return "auto_approve";
  if (IDENTITY_VERIFICATION_MODES.includes(configured as IdentityVerificationMode)) {
    return configured as IdentityVerificationMode;
  }
  throw new Error("DANCR_IDENTITY_VERIFICATION_MODE must be either auto_approve or verifymy.");
}

export function isVerifyMyIdentityMode() {
  return getIdentityVerificationMode() === "verifymy";
}

export function automaticDancerApprovalValues(now = new Date().toISOString()) {
  return {
    status: "approved" as const,
    verification_status: "approved" as const,
    approved_at: now,
    is_public: true,
  };
}
