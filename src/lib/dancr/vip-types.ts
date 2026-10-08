export type VipVenue = { id: string; name: string; timezone: string; guestName: string };
export type VipDancer = { id: string; stage_name: string; working_now: boolean };
export type VipRequest = {
  id: string; venue_id: string; guest_name: string; starts_at: string; timezone: string;
  dancers: Array<{ id: string; stageName: string }>; notes: string;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  response_note: string; created_at: string;
};
export type VipInvitation = { venueName: string; maskedEmail: string; expiresAt: string };
export type VipState = { venues: VipVenue[]; selectedVenueId: string; dancers: VipDancer[]; requests: VipRequest[]; hasMore: boolean };
export type VenueVipState = {
  invitations: Array<{ id: string; email: string; expires_at: string }>;
  members: Array<{ id: string; display_name: string }>;
  requests: VipRequest[]; hasMore: boolean;
};

export function formatVipDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
}

export function vipLocalDate(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)?.value).join("-");
}
