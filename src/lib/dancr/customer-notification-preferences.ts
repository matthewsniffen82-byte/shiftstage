export const CUSTOMER_EMAIL_CONSENT_VERSION = "customer-email-v2";
export const CUSTOMER_EMAIL_CONSENT_TEXT = "Email me MyDancr offers and newsletters.";
export const CUSTOMER_FOLLOW_EMAIL_CONSENT_TEXT = "Email me updates from dancers and clubs I follow.";
export const CUSTOMER_EMAIL_CHOICES = [
  { key: "followEmailEnabled", title: "Follow updates", text: CUSTOMER_FOLLOW_EMAIL_CONSENT_TEXT },
  { key: "emailEnabled", title: "Offers & newsletters", text: CUSTOMER_EMAIL_CONSENT_TEXT },
] as const;
export type CustomerEmailKey = typeof CUSTOMER_EMAIL_CHOICES[number]["key"];

export const CUSTOMER_FOLLOW_ALERTS = [
  { key: "workingNow", title: "Working Now", description: "A dancer you follow starts working." },
  { key: "upcomingShifts", title: "Upcoming shifts", description: "A dancer you follow posts a shift." },
  { key: "clubDeals", title: "New Club Deals", description: "Deals and offers from clubs you follow or subscribe to." },
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
  followEmailEnabled: false,
  pushEnabled: true,
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
    case "vip_dancer_working_now":
    case "followed_dancer_working_now": return "workingNow";
    case "followed_dancer_upcoming_shift": return "upcomingShifts";
    case "club_offer":
    case "followed_club_deal_published": return "clubDeals";
    case "followed_club_roster_addition": return "newDancers";
    default: return null;
  }
}
