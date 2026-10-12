import type { VenueValueReport } from "./venue-analytics";

export const ADMIN_GUEST_SECTIONS = ["visits", "members", "invitations", "guests", "rides", "updates", "results"] as const;
export type AdminGuestSection = typeof ADMIN_GUEST_SECTIONS[number];
export type AdminGuestRow = {
  id: string; name: string; status: string; createdAt: string;
  email?: string | null; phone?: string | null; nickname?: string;
  startsAt?: string; expiresAt?: string; updatedAt?: string; note?: string;
  dancers?: string[]; location?: string; partySize?: number; arrivalMethod?: string;
  channel?: "email" | "text"; destination?: string; consentedAt?: string; withdrawnAt?: string | null;
};
export type AdminGuestData = {
  venue: { id: string; name: string; timezone: string; is_active: boolean };
  section: AdminGuestSection; rows: AdminGuestRow[]; hasMore: boolean;
  results?: { report: VenueValueReport; periodStart: string; periodEnd: string; totalFollowers: number };
};
export type AdminGuestAction = "request_status" | "invite" | "revoke_invitation" | "revoke_member" | "set_nickname" | "unsubscribe";
