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

export function initialDancerApprovalValues() {
  return {
    status: "draft" as const,
    verification_status: "pending" as const,
    approved_at: null,
    is_public: false,
  };
}
