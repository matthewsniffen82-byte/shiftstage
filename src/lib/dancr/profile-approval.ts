type DancerApprovalState = {
  status?: unknown;
  verification_status?: unknown;
  verificationStatus?: unknown;
  identity_provider?: unknown;
  identityProvider?: unknown;
  identity_verified_at?: unknown;
  identityVerifiedAt?: unknown;
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
  if (!(profile.venue_approved_at || profile.venueApprovedAt)) return false;
  const verificationStatus = normalizedStatus(profile.verification_status || profile.verificationStatus);
  const identityProvider = normalizedStatus(profile.identity_provider || profile.identityProvider);
  const identityVerifiedAt = profile.identity_verified_at || profile.identityVerifiedAt;
  if (!identityProvider && !identityVerifiedAt) {
    return verificationStatus === "approved";
  }
  return verificationStatus === "approved" && identityProvider === "verifymy_content" && Boolean(identityVerifiedAt);
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
  if (!profile || effectiveDancerProfileStatus(profile) !== "approved") return false;
  return profile.is_public !== false && profile.isPublic !== false;
}
