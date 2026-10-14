"use client";

import { useEffect, useState } from "react";
import DancerPublicProfilePreview from "./DancerPublicProfilePreview";
import { requestDancerInternalMainPhotoJson } from "./dashboard-session";
import type { DancerPhotoItem, DancerPreviewVideo, LoadState } from "./dashboard-types";

export default function DancerProfilePreviewContent({ name, city, avatarUrl, photos, videos, isPublic, onboarding, slug, onEdit, profile }: {
  name: string; city: string; avatarUrl: string; photos: DancerPhotoItem[]; videos: DancerPreviewVideo[];
  isPublic: boolean; onboarding: boolean; slug: string;
  onEdit?: (section: string) => void;
  profile?: LoadState["profile"];
}) {
  const [showPublic, setShowPublic] = useState(true);
  const [audience, setAudience] = useState<"public" | "club">("public");
  const [clubPhoto, setClubPhoto] = useState<{ id: string; source: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const photoIds = photos.map(photo => photo.id).sort().join(",");
  useEffect(() => {
    if (audience !== "club") return;
    const controller = new AbortController();
    setClubPhoto(null); setError("");
    void requestDancerInternalMainPhotoJson({ signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) setClubPhoto({ id: data.displayedPhotoId || "", source: photoIds }); })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to load your club photo."); });
    return () => controller.abort();
  }, [audience, photoIds, retry]);
  const club = clubPhoto?.source === photoIds ? photos.find(photo => photo.id === clubPhoto.id) : null;
  return <section className="dancer-workspace-preview" aria-label="Profile preview">
    {!onboarding ? <div className="dancer-workspace-view" role="group" aria-label="Preview audience">
      <button type="button" aria-pressed={audience === "public"} onClick={() => setAudience("public")}>Public profile</button>
      <button type="button" aria-pressed={audience === "club"} onClick={() => setAudience("club")}>Club display</button>
    </div> : null}
    <p className="dancer-preview-note">{onboarding ? "See exactly how your public profile will look. Private until setup is complete." : `Draft preview · Approved media only. ${isPublic ? "Your saved profile is public." : "Your public profile is hidden."}`}</p>
    {audience === "public" ? <>
      <button type="button" onClick={() => setShowPublic(true)}>Open full profile preview</button>
      {onEdit ? <div className="dancer-workspace-view" role="group" aria-label="Edit profile">
        <button type="button" aria-label="Edit name and city" onClick={() => onEdit("dancer-details-section")}>Name & city</button>
        <button type="button" aria-label="Edit avatar" onClick={() => onEdit("dancer-face-photo")}>Avatar</button>
        <button type="button" aria-label="Edit main photo" onClick={() => onEdit("dancer-main-photo")}>Main photo</button>
        <button type="button" onClick={() => onEdit("dancer-profile-media-library")}>Edit photos/videos</button>
      </div> : null}
      {showPublic ? <DancerPublicProfilePreview name={name} city={city} avatarUrl={avatarUrl} photos={photos} videos={videos} slug={slug} profile={profile} onClose={() => setShowPublic(false)} /> : null}
      {isPublic && slug ? <a href={`/dancers/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer">Open saved public profile ↗</a> : null}
    </> : <>
      <p className="dancer-preview-note">Your club roster photo and stage name. Appearing at a club also depends on your check-in and channel choice.</p>
      {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
        : !clubPhoto || clubPhoto.source !== photoIds ? <p role="status">Loading club preview…</p>
        : <div className="dancer-club-preview-card">
          {club?.imageUrl ? <img src={club.imageUrl} alt="Club roster photo preview" /> : <div className="dancer-preview-placeholder">No approved club photo</div>}
          <div><strong>{name || "Your stage name"}</strong><span>Club roster preview</span></div>
        </div>}
      <p className="dancer-preview-note">Change this image under Photos & videos → Club roster photo.</p>
    </>}
  </section>;
}
