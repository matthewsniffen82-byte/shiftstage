"use client";
import type { ClubMediaState, ClubMediaViewState } from "@/src/lib/dancr/club-media-status";
import type { MediaLibraryItem } from "./media-library-items";
import "./dancer-media-club-view.css";

export default function DancerMediaClubView({ state, disabled = false }: {
  state?: ClubMediaState & Partial<ClubMediaViewState>; photos?: MediaLibraryItem[];
  videos?: MediaLibraryItem[]; disabled?: boolean; compact?: boolean; videoLoading?: boolean; videoError?: string;
}) {
  if (!state) return null;
  return <section className="dancer-media-club-view" aria-label="Club media view">
    {state.activeClub ? <strong>Media at {state.activeClub.name}</strong> : state.onSelectClub ? <label>
      <span>Edit media for</span>
      <select value={state.selection || ""} disabled={disabled || state.loading || Boolean(state.error)}
        onChange={event => state.onSelectClub?.(event.target.value)}>
        <option value="" disabled>Choose a club</option>
        {state.clubs?.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
      </select>
    </label> : null}
    <p>{state.loading ? "Loading your club media…" : state.error || (state.selectedClub
      ? `Photos, videos and updates for ${state.selectedClub.name}.`
      : "Choose a connected club to edit its photos and videos.")}</p>
  </section>;
}
