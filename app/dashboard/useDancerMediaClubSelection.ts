"use client";
import { useState } from "react";
import { mediaClubOptions, selectedMediaClub, type ClubMediaState, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";

export function useDancerMediaClubSelection(state: ClubMediaState, profileId: unknown): ClubMediaViewState {
  const activeClub = selectedMediaClub(state) ? state.activeClub : null;
  const current = { ...state, activeClub };
  const clubs = mediaClubOptions(current);
  const [choice, setChoice] = useState<{ owner: unknown; value: string }>({ owner: profileId, value: "all" });
  const requested = choice.owner === profileId ? choice.value : "all";
  const selection = activeClub ? "auto" : clubs.some(club => club.id === requested) ? requested : "all";
  const selectedClub = activeClub || selectedMediaClub(current, selection);
  const checkIn = activeClub ? `${activeClub.id}:${activeClub.workingUntil}` : `off:${selection}`;
  const [libraryView, setLibraryView] = useState<{ owner: unknown; checkIn: string; all: boolean } | null>(null);
  const showAllMedia = Boolean(libraryView && libraryView.owner === profileId && libraryView.checkIn === checkIn && libraryView.all);
  return { ...current, clubs, selection, selectedClub, showAllMedia,
    filterToClub: !showAllMedia && Boolean(selectedClub || state.loading || state.error),
    onSelectClub: activeClub ? undefined : value => setChoice({ owner: profileId, value }),
    onShowAllMedia: all => setLibraryView({ owner: profileId, checkIn, all }) };
}
