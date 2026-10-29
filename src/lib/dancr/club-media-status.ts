import { mediaRejectionLabel } from "./media-review-label.ts";

export type ClubMediaStatus = {
  id: string; photoId: string | null; kind: string; venueId: string;
  venueName: string; status: string; reason: string | null;
  hidden?: boolean; isMain?: boolean; isPinned?: boolean | null;
};
export type MediaClub = { id: string; name: string };
export type ClubMediaRequirements = { venueId: string; approvedPhotos: number; approvedVideos: number; hasApprovedMain: boolean; eligible: boolean };
export type ClubMediaState = {
  statuses: ClubMediaStatus[]; error: string; loading?: boolean;
  requirements?: ClubMediaRequirements[];
  activeClub?: (MediaClub & { workingUntil: string }) | null;
  selectedClub?: MediaClub | null;
  clubs?: MediaClub[];
  filterToClub?: boolean;
};
export type ClubMediaViewState = ClubMediaState & {
  clubs: MediaClub[];
  selection: string;
  onSelectClub?: (value: string) => void;
};

export function mediaClubOptions(state: ClubMediaState) {
  const clubs = new Map<string, MediaClub>();
  for (const club of state.clubs || []) clubs.set(club.id, club);
  for (const row of state.statuses) if (row.venueId && row.venueName) clubs.set(row.venueId, { id: row.venueId, name: row.venueName });
  if (state.activeClub) clubs.set(state.activeClub.id, state.activeClub);
  return [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function selectedMediaClub(state: ClubMediaState, selection = "auto", now = Date.now()): MediaClub | null {
  if (selection === "auto") return state.activeClub && Date.parse(state.activeClub.workingUntil) > now ? state.activeClub : null;
  return mediaClubOptions(state).find(club => club.id === selection) || null;
}

export function selectedClubMediaRows(state?: ClubMediaState) {
  if (!state || state.error || state.selectedClub === null) return [];
  return state.selectedClub ? state.statuses.filter(row => row.venueId === state.selectedClub?.id) : state.statuses;
}

export function mediaClubItemLabel(state: ClubMediaState | undefined, id: string, kind = "photo", platformStatus = "approved") {
  if (!state?.selectedClub) return "";
  if (state.error) return "Club approval unavailable";
  if (state.loading) return "Checking club approval…";
  if (["rejected", "denied"].includes(platformStatus)) return "Not approved for publication";
  const decision = mediaClubStatuses(selectedClubMediaRows(state), id, kind)[0]?.status;
  const club = state.selectedClub.name;
  if (decision === "rejected") return `Not approved at ${club}`;
  if (decision === "approved") return platformStatus === "approved" ? `Approved at ${club}` : `Approved at ${club} · Awaiting final approval`;
  return `Awaiting approval at ${club}`;
}

export function clubPreviewMedia<T extends { id: string; status: string; isPrimary?: boolean; distributionScope?: string }>(
  items: T[], state: ClubMediaState, kind = "photo",
): T[] {
  if (!state.selectedClub || state.error || state.loading) return [];
  return items.filter(item => item.status === "approved" && (kind !== "video" || item.distributionScope !== "feed_only")
    && mediaClubStatuses(selectedClubMediaRows(state), item.id, kind).some(row => row.status === "approved" && !row.hidden));
}

// One club's published media and unfinished updates share a single editor.
// The complete inventory is retained separately for storage limits.
export function clubEditorMedia<T extends { id: string; status: string; distributionScope?: string; editorVenueId?: string | null; previewKey?: string }>(
  items: T[], state?: ClubMediaState, kind = "photo",
): T[] {
  if (!state?.filterToClub) return items;
  if (!state.selectedClub || state.loading || state.error) return [];
  return items.filter(item => (kind !== "video" || item.distributionScope !== "feed_only") && (
    mediaClubStatuses(selectedClubMediaRows(state), item.id, kind).some(row => !row.hidden)
    || item.previewKey && item.editorVenueId === state.selectedClub?.id
  ));
}

export function mediaClubStatuses(rows: ClubMediaStatus[], id: string | undefined, kind = "photo") {
  return id ? rows.filter(row => row.kind === kind && (row.photoId === id || row.id === id
    || id === `review:${row.id}` || id === `pending:${row.id}`)) : [];
}

export function mediaClubRejection(rows: ClubMediaStatus[], id: string | undefined, kind = "photo") {
  const rejected = mediaClubStatuses(rows, id, kind).some(row => row.status === "rejected");
  // Keep the display neutral; stored decisions remain scoped to their clubs.
  return rejected ? mediaRejectionLabel(kind === "video" ? "video" : "photo") : "";
}
