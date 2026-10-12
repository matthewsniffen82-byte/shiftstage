export const CLUB_PRIVACY_CHANGED_EVENT = "mydancr:club-privacy-changed";

export type ClubUpdatePreference = {
  id: string; channel: "email" | "text"; destination: string;
  consentedAt: string; withdrawnAt: string | null;
};
export type CustomerClubPrivacy = {
  venue_id: string; venue_name: string;
  share: { name: string; email: string; city: string; consentedAt: string } | null;
  subscriptions: ClubUpdatePreference[];
};

// Accept only a private MyDancr update URL or the opaque token itself.
export function updateLinkToken(value: unknown, origin: string) {
  if (typeof value !== "string" || value.length > 512) return null;
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(input)) return input;
  try {
    const url = new URL(input, origin);
    if (url.origin !== origin || url.search || url.hash || url.username || url.password) return null;
    return /^\/updates\/([A-Za-z0-9_-]{43})\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}
