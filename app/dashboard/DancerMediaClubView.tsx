"use client";
import type { ClubMediaState, ClubMediaViewState } from "@/src/lib/dancr/club-media-status";
import type { MediaLibraryItem } from "./media-library-items";
import { verifiedVenueLogoUrl } from "@/src/lib/dancr/venue-branding";
import "./dancer-media-club-view.css";

export default function DancerMediaClubView({ state, disabled = false, compact = false }: {
  state?: ClubMediaState & Partial<ClubMediaViewState>; photos?: MediaLibraryItem[];
  videos?: MediaLibraryItem[]; disabled?: boolean; compact?: boolean; videoLoading?: boolean; videoError?: string;
}) {
  if (!state) return null;
  const requirements = !state.loading && !state.error ? state.requirements?.find(item => item.venueId === state.selectedClub?.id) : null;
  return <section className="dancer-media-club-view" aria-label="Club media view">
    {state.onSelectClub ? <details className="dancer-media-club-picker">
      <summary aria-disabled={disabled || state.loading || Boolean(state.error)} onClick={event => {
        if (disabled || state.loading || state.error) event.preventDefault();
      }}>Club: {state.selectedClub?.name || "Choose a club"}<span aria-hidden="true">⌄</span></summary>
      <div role="group" aria-label="Choose media club">
        {state.clubs?.map(club => {
          const rows = state.statuses.filter(row => row.venueId === club.id && !row.hidden);
          const approved = rows.filter(row => row.submissionState === "approved" || !row.submissionState && row.status === "approved").length;
          const pending = rows.filter(row => row.submissionState === "pending" || !row.submissionState && row.status === "pending").length;
          const logo = verifiedVenueLogoUrl(club.slug);
          return <button key={club.id} type="button" aria-pressed={state.selectedClub?.id === club.id}
            disabled={disabled || state.loading || Boolean(state.error)} onClick={event => {
              state.onSelectClub?.(club.id); event.currentTarget.closest("details")?.removeAttribute("open");
            }}>
            {logo ? <img src={logo} alt="" /> : <span className="dancer-media-club-initial" aria-hidden="true">{club.name.slice(0, 1)}</span>}
            <span><strong>{club.name}</strong><small>{approved} approved · {pending} pending{state.activeClub?.id === club.id ? " · Working now" : ""}</small></span>
            {state.selectedClub?.id === club.id ? <span aria-label="Selected">✓</span> : null}
          </button>;
        })}
      </div>
    </details> : state.selectedClub ? <strong>Media at {state.selectedClub.name}</strong> : null}
    <p>{state.loading ? "Loading your club media…" : state.error || (state.selectedClub
      ? `Photos, videos and updates for ${state.selectedClub.name}.`
      : "Choose a connected club to edit its photos and videos.")}</p>
    {requirements && !compact && <div aria-label="Club media requirements">
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
