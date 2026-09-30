import { normalizeShuttlePhone } from "./club-deal-transportation.ts";

export type GuestListDetails = { name: string; phone: string; email: string; consent: true };

export function normalizeGuestListDetails(value: unknown): GuestListDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = normalizeShuttlePhone(input.phone);
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (name.length < 2 || name.length > 100 || /[\x00-\x1f\x7f]/.test(name) || !phone
    || email.length > 254 || (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    || input.consent !== true) return null;
  return { name, phone, email, consent: true };
}

export type VenueGuestListEntry = {
  id: string; name: string; phone: string; email: string | null;
  createdAt: string; expiresAt: string; arrivalMethod: string; status: string;
};
