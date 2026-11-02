"use client";
import type { ClubMediaState, ClubMediaViewState } from "@/src/lib/dancr/club-media-status";
import type { MediaLibraryItem } from "./media-library-items";
import "./dancer-media-club-view.css";

export default function DancerMediaClubView({ state, disabled = false }: {
  state?: ClubMediaState & Partial<ClubMediaViewState>; photos?: MediaLibraryItem[];
  videos?: MediaLibraryItem[]; disabled?: boolean; compact?: boolean; videoLoading?: boolean; videoError?: string;
}) {
  if (!state) return null;
  const requirements = !state.loading && !state.error ? state.requirements?.find(item => item.venueId === state.selectedClub?.id) : null;
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
    {requirements && <div aria-label="Club media requirements">
      <p className="dancer-media-library-requirement" data-complete={requirements.approvedPhotos >= 3 || undefined}>
        {requirements.approvedPhotos >= 3 ? <span className="dancer-media-requirement-check" role="img" aria-label="Requirement met">✓</span> : null}{" "}
        <strong>{requirements.approvedPhotos} {requirements.approvedPhotos === 1 ? "photo" : "photos"} approved</strong> · minimum 3
      </p>
      <p className="dancer-media-library-requirement" data-complete={requirements.approvedVideos >= 1 || undefined}>
        {requirements.approvedVideos >= 1 ? <span className="dancer-media-requirement-check" role="img" aria-label="Requirement met">✓</span> : null}{" "}
        <strong>{requirements.approvedVideos} {requirements.approvedVideos === 1 ? "video" : "videos"} approved</strong> · minimum 1
      </p>
      <p className="dancer-media-library-requirement" data-complete={requirements.hasApprovedMain || undefined}>
        {requirements.hasApprovedMain ? <span className="dancer-media-requirement-check" role="img" aria-label="Requirement met">✓</span> : null}{" "}
        <strong>Main photo {requirements.hasApprovedMain ? "approved" : "needed"}</strong>
      </p>
      <p>More photos and videos are optional.</p>
    </div>}
  </section>;
}
