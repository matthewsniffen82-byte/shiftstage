export const CUSTOMER_FOLLOW_ALERTS = [
  { key: "workingNow", title: "Working Now", description: "A dancer you follow starts working." },
  { key: "upcomingShifts", title: "Upcoming shifts", description: "A dancer you follow posts a shift." },
  { key: "clubDeals", title: "New Club Deals", description: "A favorite club publishes a deal." },
  { key: "newDancers", title: "New dancers", description: "A dancer joins a favorite club." },
] as const;

export type CustomerAlertKey = typeof CUSTOMER_FOLLOW_ALERTS[number]["key"];
export const DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS = {
  followAlertsEnabled: true,
  workingNow: true,
  upcomingShifts: true,
  clubDeals: true,
  newDancers: true,
  emailEnabled: false,
  pushEnabled: false,
};
export type CustomerNotificationSettings = typeof DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS;
export type CustomerNotificationKey = keyof CustomerNotificationSettings;

export function customerNotificationSettings(value: unknown): CustomerNotificationSettings {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS).map(([key, fallback]) => [key,
    typeof settings[key] === "boolean" ? settings[key] : fallback,
  ])) as CustomerNotificationSettings;
}

export function parseCustomerNotificationPatch(value: unknown): Partial<CustomerNotificationSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Notification settings must be an object.");
  const entries = Object.entries(value);
  if (!entries.length) throw new Error("Choose a notification setting to update.");
  for (const [key, enabled] of entries) {
    if (!Object.hasOwn(DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS, key) || typeof enabled !== "boolean") {
      throw new Error("Choose on or off for a supported notification setting.");
    }
  }
  return Object.fromEntries(entries);
}

export function customerFollowAlertsEnabled(settings: unknown) {
  return customerNotificationSettings(settings).followAlertsEnabled;
}

export function customerFollowAlertEnabled(settings: unknown, key: CustomerAlertKey) {
  const preferences = customerNotificationSettings(settings);
  return preferences.followAlertsEnabled && preferences[key];
}

export function followAlertKey(kind: unknown): CustomerAlertKey | null {
  switch (kind) {
    case "followed_dancer_working_now": return "workingNow";
    case "followed_dancer_upcoming_shift": return "upcomingShifts";
    case "followed_club_deal_published": return "clubDeals";
    case "followed_club_roster_addition": return "newDancers";
    default: return null;
  }
}
