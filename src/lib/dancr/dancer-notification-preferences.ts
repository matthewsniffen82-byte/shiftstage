export const DANCER_ACTIVITY_ALERTS = [
  { key: "followers", label: "New followers", description: "Someone starts following your profile." },
  { key: "profileLikes", label: "Profile likes", description: "Someone likes your profile." },
  { key: "photoLikes", label: "Photo likes", description: "Someone likes one of your photos." },
  { key: "videoLikes", label: "Video likes", description: "Someone likes one of your videos." },
  { key: "shares", label: "Profile and media shares", description: "Someone shares your profile, photo, or video." },
] as const;

const DANCER_NOTIFICATION_KEYS = ["activityAlertsEnabled", ...DANCER_ACTIVITY_ALERTS.map(alert => alert.key)] as const;
export type DancerNotificationKey = typeof DANCER_NOTIFICATION_KEYS[number];
export type DancerNotificationSettings = Record<DancerNotificationKey, boolean>;
const metadataKey = (key: DancerNotificationKey) => `mydancr_dancer_notify_${key}`;

export function dancerNotificationSettings(metadata: unknown): DancerNotificationSettings {
  const values = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return Object.fromEntries(DANCER_NOTIFICATION_KEYS.map(key => [key, values[metadataKey(key)] !== false])) as DancerNotificationSettings;
}

export function dancerNotificationMetadataPatch(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a notification setting to update.");
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, enabled]) => !DANCER_NOTIFICATION_KEYS.some(item => item === key) || typeof enabled !== "boolean")) {
    throw new Error("Choose on or off for a supported notification setting.");
  }
  // Separate metadata keys let Auth merge independent changes without replacing
  // the other preferences or any existing account metadata.
  return Object.fromEntries(entries.map(([key, enabled]) => [metadataKey(key as DancerNotificationKey), enabled as boolean]));
}

export function dancerEngagementAlertEnabled(metadata: unknown, engagement: "like" | "follow" | "share", target: "profile" | "photo" | "video") {
  const key: DancerNotificationKey = engagement === "follow" ? "followers" : engagement === "share" ? "shares"
    : target === "photo" ? "photoLikes" : target === "video" ? "videoLikes" : "profileLikes";
  const settings = dancerNotificationSettings(metadata);
  return settings.activityAlertsEnabled && settings[key];
}
