export type PickupRole = "customer" | "venue" | "admin";
export type PickupVenue = { id: string; name: string; slug: string };
export type PhonePickupRequest = {
  id: string; venue_id: string; venue_name: string; requested_at: string;
  name: string; location: string; phone: string; email: string; party_size: number;
};
