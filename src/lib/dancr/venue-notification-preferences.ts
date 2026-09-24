export const VENUE_NOTIFICATION_ALERTS = [
  { key: "dancerActivity", title: "Dancer activity", description: "Working Now and scheduled appearance updates." },
  { key: "rosterChanges", title: "Roster changes", description: "Dancer affiliations added or removed." },
  { key: "clubDeals", title: "Club Deals", description: "Deal updates and requests that need attention." },
  { key: "pickupRequests", title: "Pickup requests", description: "Guests requesting transportation to your club." },
  { key: "teamAccess", title: "Team access", description: "Invitations and changes to your venue team." },
  { key: "pageAndMedia", title: "Venue page & media", description: "Page publication, reviews, and media updates." },
  { key: "supportReplies", title: "Support replies", description: "Replies from the MyDancr team." },
  { key: "performance", title: "Performance updates", description: "Venue activity summaries and milestones." },
] as const;

export type VenueAlertKey = typeof VENUE_NOTIFICATION_ALERTS[number]["key"];
export const DEFAULT_VENUE_NOTIFICATION_SETTINGS = {
  alertsEnabled: true,
  dancerActivity: false,
  rosterChanges: true,
  clubDeals: true,
  pickupRequests: true,
  teamAccess: true,
  pageAndMedia: true,
  supportReplies: true,
  performance: false,
  emailEnabled: false,
  pushEnabled: false,
};
export type VenueNotificationSettings = typeof DEFAULT_VENUE_NOTIFICATION_SETTINGS;
export type VenueNotificationKey = keyof VenueNotificationSettings;
const metadataKey = (key: string) => `mydancr_venue_notify_${key}`;

export function venueNotificationSettings(metadata: unknown): VenueNotificationSettings {
  const values = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_VENUE_NOTIFICATION_SETTINGS).map(([key, fallback]) => [key,
    typeof values[metadataKey(key)] === "boolean" ? values[metadataKey(key)] : fallback,
  ])) as VenueNotificationSettings;
}

export function venueNotificationMetadataPatch(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a notification setting to update.");
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, enabled]) => !Object.hasOwn(DEFAULT_VENUE_NOTIFICATION_SETTINGS, key) || typeof enabled !== "boolean")) {
    throw new Error("Choose on or off for a supported notification setting.");
  }
  // Auth merges individual keys, preserving other preferences and account metadata.
  return Object.fromEntries(entries.map(([key, enabled]) => [metadataKey(key), enabled as boolean]));
}

type VenueNotification = { type?: unknown; notification_type?: unknown; payload?: unknown };
export function venueNotificationCategory(row: VenueNotification): VenueAlertKey | null {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {};
  const kind = String(payload.kind || payload.event || "");
  // Account recovery, security and legal notices remain outside optional alerts.
  if (["account_security", "password_changed", "email_changed", "account_access_changed"].includes(kind)) return null;
  if (kind === "club_shuttle_request" || kind === "club_pickup") return "pickupRequests";
  if (kind.startsWith("venue_team_") || kind.startsWith("team_invitation_")) return "teamAccess";
  if (kind.startsWith("club_deal_") || kind.startsWith("venue_deal_")) return "clubDeals";
  if (kind.startsWith("venue_checkin_") || kind.startsWith("venue_checkout_")) return "dancerActivity";
  switch (row.notification_type || row.type) {
    case "shift_posted": case "shift_updated": case "shift_cancelled": return "dancerActivity";
    case "venue_affiliation_status": return "rosterChanges";
    case "venue_claim_status": case "venue_publication_status": case "approval_status": case "tv_video_status": return "pageAndMedia";
    case "support_message": return "supportReplies";
    case "weekly_summary": case "ranking_milestone": case "engagement": return "performance";
    default: return null;
  }
}

export function venueNotificationEnabled(metadata: unknown, row: VenueNotification, channel?: "emailEnabled" | "pushEnabled") {
  const category = venueNotificationCategory(row);
  if (!category) return true;
  const settings = venueNotificationSettings(metadata);
  return settings.alertsEnabled && settings[category] && (!channel || settings[channel]);
}
