"use client";
import { useState } from "react";
import { mediaClubOptions, selectedMediaClub, type ClubMediaState, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";

export function useDancerMediaClubSelection(state: ClubMediaState, profileId: unknown): ClubMediaViewState {
  const activeClub = selectedMediaClub(state) ? state.activeClub : null;
  const current = { ...state, activeClub };
  const clubs = mediaClubOptions(current);
  const [choice, setChoice] = useState<{ owner: unknown; value: string }>({ owner: profileId, value: "" });
  const requested = choice.owner === profileId ? choice.value : "";
  const selection = activeClub ? "auto" : clubs.some(club => club.id === requested) ? requested : clubs.length === 1 ? clubs[0].id : "";
  const selectedClub = activeClub || selectedMediaClub(current, selection);
  return { ...current, clubs, selection, selectedClub,
    filterToClub: true,
    onSelectClub: activeClub ? undefined : value => setChoice({ owner: profileId, value }),
  };
}
