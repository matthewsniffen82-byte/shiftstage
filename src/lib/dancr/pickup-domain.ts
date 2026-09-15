export const PICKUP_CONSENT_VERSION = "pickup-chat-v1";
export const PICKUP_TRANSPORT_NOTICE = "Transportation, if available, is provided and controlled by the venue. MyDancr provides the communication and customer-referral platform and does not operate the vehicle.";
export const PICKUP_CHAT_NOTICE = "Messages in this pickup conversation are stored and may be monitored or reviewed by MyDancr for pickup verification, customer attribution, safety, fraud prevention, dispute resolution, and enforcement of MyDancr policies. By continuing, you consent to this monitoring and retention.";
export const PICKUP_CHAT_POLICY = "Use this chat only for venue pickup coordination. Escort arrangements, sexual-service negotiations, illegal drug transactions, threats, harassment, and requests for private dancer information are prohibited.";
export const PICKUP_STATUS_LABELS = {
  requested: "Pickup Requested", accepted: "Venue Accepted", vehicle_dispatched: "Vehicle Dispatched",
  arriving: "Arriving", arrived: "Arrived", completed: "Completed", cancelled: "Cancelled", no_show: "No Show", expired: "Expired",
} as const;
export type PickupStatus = keyof typeof PICKUP_STATUS_LABELS;
export type PickupRole = "customer" | "venue" | "admin";
export const PICKUP_ACTIVE_STATUSES: PickupStatus[] = ["requested", "accepted", "vehicle_dispatched", "arriving", "arrived"];
export function pickupClosed(status: PickupStatus) { return !PICKUP_ACTIVE_STATUSES.includes(status); }
export function pickupStatusActions(role: PickupRole, status: PickupStatus): PickupStatus[] {
  if (role === "admin" || pickupClosed(status)) return [];
  if (role === "customer") return status === "arrived" ? [] : [
    ...(["accepted", "vehicle_dispatched", "arriving"].includes(status) ? ["arrived" as const] : []), "cancelled",
  ];
  const next: Record<string, PickupStatus[]> = {
    requested: ["accepted", "cancelled"], accepted: ["vehicle_dispatched", "arrived", "no_show", "cancelled"],
    vehicle_dispatched: ["arriving", "arrived", "no_show", "cancelled"], arriving: ["arrived", "no_show", "cancelled"], arrived: ["completed"],
  };
  return next[status] || [];
}
export type PickupVenue = { id: string; name: string; slug: string; club_pickup_enabled: boolean; eligible?: boolean };
export type PhonePickupRequest = {
  id: string; venue_id: string; venue_name: string; requested_at: string;
  name: string; location: string; phone: string; email: string; party_size: number;
};
export type PickupRequest = {
  id: string; customer_user_id: string; venue_id: string; status: PickupStatus; party_size: number;
  pickup_location_text: string; pickup_location_details: string; customer_notes: string;
  requested_at: string; expires_at: string; accepted_at: string | null; vehicle_dispatched_at: string | null;
  arrived_at: string | null; completed_at: string | null; cancelled_at: string | null;
  cancellation_reason: string | null; referral_source: string; referral_outcome: string; updated_at: string;
  venue: { name: string; slug: string } | null; unread_count?: number;
};
export type PickupMessage = { id: string; sequence: number; sender_type: "customer" | "venue" | "system"; message_text: string; created_at: string };
export type PickupEvent = { id: string; event_type: string; actor_user_id: string | null; metadata: Record<string, unknown>; created_at: string };
export type PickupEvidence = { id: string; source: string; actor_user_id: string | null; redemption_id: string | null; created_at: string };
export type PickupReport = { id: string; reporter_user_id: string; reason: string; details: string; created_at: string };
export type PickupDetail = {
  request: PickupRequest; role: PickupRole; consented: boolean; messages: PickupMessage[]; hasOlderMessages: boolean;
  events: PickupEvent[]; hasMoreEvents: boolean; reports: PickupReport[]; evidence: PickupEvidence[];
};
