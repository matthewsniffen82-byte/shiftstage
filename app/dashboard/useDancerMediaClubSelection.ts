"use client";
import { useState } from "react";
import { selectedMediaClub, type ClubMediaState, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";

export function useDancerMediaClubSelection(state: ClubMediaState, profileId: unknown): ClubMediaViewState {
  const selectedClub = selectedMediaClub(state);
  const checkIn = selectedClub ? `${selectedClub.id}:${state.activeClub?.workingUntil}` : "off";
  const [libraryView, setLibraryView] = useState<{ owner: unknown; checkIn: string; all: boolean } | null>(null);
  const showAllMedia = Boolean(libraryView && libraryView.owner === profileId && libraryView.checkIn === checkIn && libraryView.all);
  return { ...state, activeClub: selectedClub ? state.activeClub : null, selectedClub, showAllMedia,
    filterToClub: !showAllMedia && Boolean(selectedClub || state.loading || state.error),
    onShowAllMedia: all => setLibraryView({ owner: profileId, checkIn, all }) };
}
