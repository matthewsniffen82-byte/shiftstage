export const RIDE_STATUSES = { received: "Received", contacted: "Contacted", arranged: "Arranged", completed: "Completed", cancelled: "Cancelled" } as const;
export type RideStatus = keyof typeof RIDE_STATUSES;
export type VenueOperations = {
  vipPending: number; tablePending: number; guestExpected: number; admitted: number; ridesOpen: number;
  teamReady: boolean; checkInReady: boolean;
};
export const VENUE_OPERATIONS_CHANGED = "mydancr:venue-operations-changed";
export function notifyVenueOperationsChanged() {
  window.dispatchEvent(new Event(VENUE_OPERATIONS_CHANGED));
}
