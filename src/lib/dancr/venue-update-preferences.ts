export const VENUE_UPDATE_CONSENT_VERSION = "venue-updates-v1";
export type VenueUpdateChoices = { email: boolean; text: boolean; version: typeof VENUE_UPDATE_CONSENT_VERSION };
export type VenueUpdateReceipt = { channel: "email" | "text"; manageUrl: string; active: boolean };

export function normalizeVenueUpdateChoices(value: unknown, email: string): VenueUpdateChoices | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const choice = value as Record<string, unknown>;
  if (typeof choice.email !== "boolean" || typeof choice.text !== "boolean" || choice.version !== VENUE_UPDATE_CONSENT_VERSION
    || (choice.email && !email)) return null;
  return { email: choice.email, text: choice.text, version: VENUE_UPDATE_CONSENT_VERSION };
}

export function readVenueUpdateChoices(form: FormData): VenueUpdateChoices | undefined {
  const email = form.get("emailUpdates") === "on", text = form.get("textUpdates") === "on";
  return email || text ? { email, text, version: VENUE_UPDATE_CONSENT_VERSION } : undefined;
}
