export const VENUE_SHARING_CONSENT_VERSION = "venue-customer-sharing-v1";
export type VenueCustomer = {
  id: string; name: string; email: string | null; phone: string | null; city: string;
  joined_at: string; is_follower: boolean; is_guest: boolean;
};
export type VenueShare = { name: string; email: string; city: string; consented_at: string };

export function normalizeVenueShare(value: Record<string, unknown>) {
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const city = typeof value.city === "string" ? value.city.trim() : "";
  if (value.consent !== true || value.consentVersion !== VENUE_SHARING_CONSENT_VERSION
    || name.length < 2 || name.length > 100 || city.length > 100 || /[\x00-\x1f\x7f]/.test(name + city)) return null;
  return { name, city };
}
