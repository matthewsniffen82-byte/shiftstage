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
  const names = [...new Set(mediaClubStatuses(rows, id, kind).filter(row => row.status === "rejected").map(row => row.venueName))];
  // A rejection is scoped to these clubs, even when another club approved it.
  return names.length ? `Not approved by ${names.join(", ")}` : "";
}
