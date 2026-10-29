"use client";
import { clubPreviewMedia, mediaClubOptions, type ClubMediaState, type ClubMediaViewState } from "@/src/lib/dancr/club-media-status";
import type { MediaLibraryItem } from "./media-library-items";
import "./dancer-media-club-view.css";

export default function DancerMediaClubView({ state, photos = [], videos = [], disabled = false, compact = false, videoLoading = false, videoError = "" }: {
  state?: ClubMediaState & Partial<ClubMediaViewState>; photos?: MediaLibraryItem[];
  videos?: (MediaLibraryItem & { distributionScope?: string })[]; disabled?: boolean; compact?: boolean;
  videoLoading?: boolean; videoError?: string;
}) {
  if (!state?.onSelectClub) return null;
  const clubs = state.clubs || mediaClubOptions(state);
  const club = state.selectedClub;
  const approvedPhotos = clubPreviewMedia(photos, state).slice().sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
  const approvedVideos = clubPreviewMedia(videos, state, "video");
  return <section className="dancer-media-club-view" aria-label="Club media view">
    <label><span>Media approvals for</span>
      <select value={state.selection || "auto"} disabled={disabled || state.loading} onChange={event => state.onSelectClub?.(event.target.value)}>
        <option value="auto">{state.activeClub ? `Automatic · ${state.activeClub.name}` : "Automatic · No active check-in"}</option>
        <option value="all">All clubs</option>
        {clubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <p>{club ? `Showing approval status for ${club.name}. All your uploads remain in the library.` : "All your uploads are available. Choose a club to view its approvals."}</p>
    {state.error ? <p role="status">{state.error}</p> : state.loading ? <p role="status">Loading club approvals…</p> : null}
    {!compact && club ? <details className="dancer-club-media-preview" key={club.id}>
      <summary>Preview media at {club.name}</summary>
      {state.error || state.loading ? <p>Preview is unavailable until club approvals are loaded.</p> : <>
        <p>Only media approved for this club is shown here. Your visibility and check-in settings still apply.</p>
        <h4>Photos · {approvedPhotos.length}</h4>
        {approvedPhotos.length ? <div className="dancer-club-preview-grid" aria-label={`${club.name} approved photos`}>
          {approvedPhotos.map((photo, index) => <figure key={photo.id}>
            <img src={photo.imageUrl || undefined} alt={`Approved photo ${index + 1}`} loading="lazy" />
            {index === 0 ? <figcaption>Main photo at {club.name}</figcaption> : null}
          </figure>)}
        </div> : <p>No photos are approved for this club yet.</p>}
        <h4>Videos · {approvedVideos.length}</h4>
        {videoLoading || videoError ? <p role="status">{videoError || "Loading videos…"}</p>
          : approvedVideos.length ? <div className="dancer-club-preview-grid" aria-label={`${club.name} approved videos`}>
            {approvedVideos.map((video, index) => <video key={video.id} src={video.videoUrl || undefined} poster={video.imageUrl || undefined}
              controls playsInline preload="none" aria-label={`Approved video ${index + 1}`} />)}
          </div> : <p>No videos are approved for this club yet.</p>}
      </>}
    </details> : null}
    {!compact ? <p className="dancer-club-edit-note">Edits and deletions affect your shared library. Add a separate upload to keep an existing version for another club.</p> : null}
  </section>;
}
