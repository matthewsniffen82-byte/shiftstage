import { mediaRejectionLabel } from "./media-review-label.ts";

export type ClubMediaStatus = {
  id: string; photoId: string | null; kind: string; venueId: string;
  venueName: string; status: string; reason: string | null;
};
export type ClubMediaState = { statuses: ClubMediaStatus[]; error: string };

export function mediaClubStatuses(rows: ClubMediaStatus[], id: string | undefined, kind = "photo") {
  return id ? rows.filter(row => row.kind === kind && (row.photoId === id || row.id === id
    || id === `review:${row.id}` || id === `pending:${row.id}`)) : [];
}

export function mediaClubRejection(rows: ClubMediaStatus[], id: string | undefined, kind = "photo") {
  const rejected = mediaClubStatuses(rows, id, kind).some(row => row.status === "rejected");
  // Keep the display neutral; stored decisions remain scoped to their clubs.
  return rejected ? mediaRejectionLabel(kind === "video" ? "video" : "photo") : "";
}
