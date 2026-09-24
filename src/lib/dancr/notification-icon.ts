export type NotificationIconName = "personPlus" | "heart" | "share" | "clock" | "calendar" | "car" | "venue" | "check" | "report" | "star" | "message" | "lock" | "bell";

export function notificationIconName(notification: { type?: unknown; notification_type?: unknown; payload?: unknown; title?: unknown }): NotificationIconName {
  const payload = notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
    ? notification.payload as Record<string, unknown> : {};
  const kind = String(payload.kind || payload.event || "");
  if (kind === "club_shuttle_request" || kind === "club_pickup") return "car";
  if (["account_security", "password_changed", "email_changed", "account_access_changed"].includes(kind)) return "lock";
  if (kind.startsWith("venue_team_") || kind.startsWith("team_invitation_") || kind === "followed_club_roster_addition") return "personPlus";
  if (kind.startsWith("club_deal_") || kind.startsWith("venue_deal_") || kind === "followed_club_deal_published") return "star";
  if (kind === "followed_dancer_working_now" || kind.startsWith("venue_checkin_") || kind.startsWith("venue_checkout_")) return "clock";
  if (kind === "followed_dancer_upcoming_shift") return "calendar";
  const type = notification.type || notification.notification_type;
  if (type === "engagement") {
    if (payload.engagementType === "follow") return "personPlus";
    if (payload.engagementType === "like") return "heart";
    if (payload.engagementType === "share") return "share";
    // Older engagement notices may have copy but no structured activity payload.
    const title = String(notification.title || "").toLowerCase();
    if (title.includes("follower")) return "personPlus";
    if (title.includes("like")) return "heart";
    if (title.includes("shared")) return "share";
  }
  switch (type) {
    case "shift_posted": case "shift_updated": return "calendar";
    case "shift_cancelled": case "dmca_status": return "report";
    case "venue_affiliation_status": return "personPlus";
    case "venue_publication_status": return "venue";
    case "venue_claim_status": case "approval_status": case "tv_video_status":
      return payload.status === "approved" ? "check" : ["rejected", "changes_requested"].includes(String(payload.status)) ? "report" : "bell";
    case "support_message": return "message";
    case "weekly_summary": case "ranking_milestone": return "star";
    default: return "bell";
  }
}
