export type DancerRequestChannel = "internal" | "vip";
export type DancerRequestStatus = "pending" | "acknowledged" | "completed" | "confirmed" | "declined" | "cancelled";

export type DancerRequestItem = {
  id: string;
  label: string;
  venueName: string;
  createdAt: string;
  startsAt: string | null;
  timezone: string;
  status: DancerRequestStatus;
};

export type DancerRequestPage = { items: DancerRequestItem[]; nextOffset: number | null };

export type DancerRequestWindow = {
  channel: DancerRequestChannel;
  since: string;
  until: string;
  venueId?: string;
  label: string;
  pending: boolean;
};
