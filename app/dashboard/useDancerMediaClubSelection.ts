"use client";
import { useState } from "react";
import { mediaClubOptions, selectedMediaClub, type ClubMediaState, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";

export function useDancerMediaClubSelection(state: ClubMediaState, profileId: unknown): ClubMediaViewState {
  const [choice, setChoice] = useState<{ owner: unknown; value: string }>({ owner: profileId, value: "auto" });
  const current = { ...state, activeClub: selectedMediaClub(state) ? state.activeClub : null };
  const clubs = mediaClubOptions(current);
  const requested = choice.owner === profileId ? choice.value : "auto";
  const selection = ["auto", "all"].includes(requested) || clubs.some(club => club.id === requested) ? requested : "auto";
  return { ...current, clubs, selection, selectedClub: selectedMediaClub(current, selection),
    onSelectClub: value => setChoice({ owner: profileId, value }) };
}
