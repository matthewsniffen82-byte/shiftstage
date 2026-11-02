"use client";
import { useEffect, useRef, useState } from "react";
import { mediaClubOptions, selectedMediaClub, type ClubMediaState, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";

export function useDancerMediaClubSelection(state: ClubMediaState, profileId: unknown): ClubMediaViewState {
  const activeClub = selectedMediaClub(state) ? state.activeClub : null;
  const current = { ...state, activeClub };
  const clubs = mediaClubOptions(current);
  const [choice, setChoice] = useState<{ owner: unknown; value: string }>({ owner: profileId, value: "" });
  const openedLink = useRef<{ owner: unknown; club: string } | null>(null);
  const clubIds = clubs.map(club => club.id).join(",");
  useEffect(() => {
    const requestedClub = new URLSearchParams(window.location.search).get("mediaClub");
    if (!requestedClub || !clubIds.split(",").includes(requestedClub)) return;
    if (openedLink.current && openedLink.current.owner === profileId && openedLink.current.club === requestedClub) return;
    openedLink.current = { owner: profileId, club: requestedClub };
    setChoice(current => current.owner === profileId && current.value === requestedClub ? current : { owner: profileId, value: requestedClub });
  }, [profileId, clubIds]);
  const requested = choice.owner === profileId ? choice.value : "";
  const selection = clubs.some(club => club.id === requested) ? requested : activeClub?.id || (clubs.length === 1 ? clubs[0].id : "");
  const selectedClub = selectedMediaClub(current, selection);
  return { ...current, clubs, selection, selectedClub,
    filterToClub: true,
    onSelectClub: value => setChoice({ owner: profileId, value }),
  };
}
