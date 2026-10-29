type Venue = { id?: string; name?: string } | null;
export type DancerCheckInSnapshot = {
  profileAuthorization?: { authorized?: boolean; profileStatus?: string | null };
  clubApprovals?: Array<{ status: string; expiresAt?: string | null; venue?: Venue }>;
  affiliations?: Array<{ status?: string; venue?: Venue }>;
  enrollment?: { status?: string; tappedAt?: string; expiresAt?: string; checkInStatus?: string | null; venue?: Venue } | null;
  presence?: { workingUntil?: string | null; nextTapAllowedAt?: string | null; venue?: Venue } | null;
};

export function dancerCheckInState(state: DancerCheckInSnapshot, now = Date.now()) {
  const result = (stage: string, title: string, description: string) => ({ stage, title, description });
  const candidate = state.enrollment;
  const enrollment = candidate && ["pending", "completed", "expired", "revoked"].includes(candidate.status || "")
    && candidate.venue?.id && Number.isFinite(Date.parse(candidate.tappedAt || "")) ? candidate : null;
  const reason = enrollment?.checkInStatus;
  const club = enrollment ? state.clubApprovals?.find(item => item.venue?.id === enrollment.venue?.id) : state.clubApprovals?.[0];
  const affiliated = Boolean(enrollment?.venue?.id && state.affiliations?.some(item => item.status === "active" && item.venue?.id === enrollment.venue?.id));
  if (Date.parse(state.presence?.workingUntil || "") > now) {
    return result("working", "Working Now", `You’re checked in${state.presence?.venue?.name ? ` at ${state.presence.venue.name}` : ""}. Your six-hour window starts from your original tap.`);
  }
  if (Date.parse(state.presence?.nextTapAllowedAt || "") > now && (!enrollment || enrollment.venue?.id === state.presence?.venue?.id)) {
    return result("cooldown", "Club check-in cooldown", "Your previous club’s cooldown is active. After checkout, you can tap into another approved club. Check Working Now for your return time.");
  }
  if (club?.status === "rejected") return result("declined", "Club request declined", "Contact the club’s manager. You are not checked in there.");
  if (reason === "access_removed" || reason === "tag_inactive") return result("new_tap", "A new club tap is needed", "Use the club’s current check-in tag. If your access was removed, contact its manager first.");
  if (reason === "age_pending") return result("age_pending", "Verify 18+ before tapping", "Complete age verification, then tap the club’s check-in tag again.");
  if (reason === "agreement_pending") return result("agreement_pending", "Accept the dancer agreement", "Accept the current agreement to finish activation.");
  if ((enrollment || club?.status === "pending") && club?.status !== "approved" && !affiliated) {
    if (Date.parse(enrollment?.expiresAt || club?.expiresAt || "") <= now || enrollment?.status === "expired") {
      return result("new_tap", "Club request expired", "Tap the club’s check-in tag again to renew your request.");
    }
    return result("club_pending", "Awaiting club approval", "Your profile and media are awaiting club approval. You’re not checked in yet.");
  }
  if (club?.status === "approved" || affiliated) {
    if (reason === "profile_pending") return result("profile_pending", "Finish your profile", "Complete the remaining profile requirements before check-in can finish.");
    if (reason === "media_pending" || !state.profileAuthorization?.authorized || state.profileAuthorization?.profileStatus !== "approved") {
      return result("media_pending", "Club confirmed · Media approval pending", "Your club access is confirmed. Required media approval must finish before you can check in.");
    }
    if (!enrollment || reason === "visibility_required" || reason === "tap_expired" || enrollment.status === "completed" ||
      Date.parse(enrollment.tappedAt || "") + 6 * 60 * 60 * 1000 <= now) {
      return result("ready", "Approved—tap again to check in", "Your profile and club access are approved. Tap at the club when you arrive to start Working Now.");
    }
    return result("checking", "Completing your saved check-in", "Your approvals are ready. Refresh to confirm your check-in status.");
  }
  if (state.profileAuthorization?.authorized && state.profileAuthorization.profileStatus === "approved") {
    return result("ready", "Approved—tap again to check in", "Tap the club’s check-in tag when you arrive to start Working Now.");
  }
  if (state.affiliations?.length) return result("access_pending", "Check your club access", "No completed check-in found. Review your club access before tapping again.");
  return result("no_tap", "Ready for your first club tap", "No club tap found. Tap the club’s tag, choose your visibility, and confirm.");
}
