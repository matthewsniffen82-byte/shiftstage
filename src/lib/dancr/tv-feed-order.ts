export const MYDANCR_TV_PREFERRED_VENUE_LEAD_LIMIT = 6;

type VenueScopedVideo = {
  id: string;
  venue: { id: string } | null;
};

export function prioritizeMyDancrTvVenue<T extends VenueScopedVideo>(
  rows: readonly T[],
  preferredVenueId = "",
  selectedVideoId = "",
): T[] {
  if (!preferredVenueId) return [...rows];
  const selected = selectedVideoId
    ? rows.find((video) => video.id === selectedVideoId) || null
    : null;
  const remaining = selected ? rows.filter((video) => video.id !== selected.id) : [...rows];
  const preferred = remaining.filter((video) => video.venue?.id === preferredVenueId);
  const cityWide = remaining.filter((video) => video.venue?.id !== preferredVenueId);
  const preferredLead = preferred.slice(0, MYDANCR_TV_PREFERRED_VENUE_LEAD_LIMIT);
  const preferredRemainder = preferred.slice(MYDANCR_TV_PREFERRED_VENUE_LEAD_LIMIT);
  const prioritized = [...preferredLead, ...cityWide, ...preferredRemainder];
  return selected ? [selected, ...prioritized] : prioritized;
}
