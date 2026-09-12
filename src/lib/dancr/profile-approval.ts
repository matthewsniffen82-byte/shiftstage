type DancerApprovalState = {
  status?: unknown;
  verification_status?: unknown;
  verificationStatus?: unknown;
  venue_approved_at?: unknown;
  venueApprovedAt?: unknown;
  disabled_at?: unknown;
  disabledAt?: unknown;
  is_public?: unknown;
  isPublic?: unknown;
};

function normalizedStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isCoreVerificationApproved(profile: DancerApprovalState | null | undefined) {
  if (!profile) return false;
  return normalizedStatus(profile.verification_status || profile.verificationStatus) === "approved";
}

export function initialDancerApprovalValues() {
  return {
    status: "draft" as const,
    verification_status: "pending" as const,
    approved_at: null,
    is_public: false,
  };
}

export function automaticDancerApprovalValues(now = new Date().toISOString()) {
  return {
    status: "approved" as const,
    verification_status: "approved" as const,
    approved_at: now,
    is_public: true,
  };
}

export function effectiveDancerProfileStatus(
  profile: DancerApprovalState | null | undefined,
  accountState?: unknown,
) {
  const normalizedAccountState = normalizedStatus(accountState);
  if (normalizedAccountState && normalizedAccountState !== "active") return normalizedAccountState;
  if (!profile) return "draft";
  if (profile.disabled_at || profile.disabledAt) return "disabled";

  const status = normalizedStatus(profile.status);
  const verificationStatus = normalizedStatus(profile.verification_status || profile.verificationStatus);
  if (status === "rejected" || status === "disabled") return status;
  if (isCoreVerificationApproved(profile)) return "approved";
  if (verificationStatus === "rejected") return "rejected";
  if (verificationStatus && (status === "approved" || status === "verified")) return "pending_review";
  return status || "draft";
}

export function isPublicDancerProfileEligible(profile: DancerApprovalState | null | undefined) {
  if (!profile || profile.status !== "approved" || !isCoreVerificationApproved(profile)) return false;
  if (profile.disabled_at || profile.disabledAt) return false;
  // Public readers require an explicit publication decision. Missing schema or
  // contradictory representations must never make a profile visible.
  if (profile.is_public !== undefined && profile.is_public !== true) return false;
  if (profile.isPublic !== undefined && profile.isPublic !== true) return false;
  return profile.is_public === true || profile.isPublic === true;
}
