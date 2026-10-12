"use client";

import { useEffect, useState } from "react";
import { DancerPhotoCarousel } from "@/app/dancers/[slug]/DancerPhotoCarousel";
import { requestDancerInternalMainPhotoJson } from "./dashboard-session";
import type { DancerPhotoItem, DancerPreviewVideo } from "./dashboard-types";

export default function DancerProfilePreviewContent({ name, city, avatarUrl, photos, videos, isPublic, onboarding, slug, onEdit }: {
  name: string; city: string; avatarUrl: string; photos: DancerPhotoItem[]; videos: DancerPreviewVideo[];
  isPublic: boolean; onboarding: boolean; slug: string;
  onEdit?: (section: string) => void;
}) {
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
  const main = photos.find(photo => photo.isPrimary) || photos[0];
  const club = clubPhoto?.source === photoIds ? photos.find(photo => photo.id === clubPhoto.id) : null;
  return <section className="dancer-workspace-preview" aria-label="Profile preview">
    {!onboarding ? <div className="dancer-workspace-view" role="group" aria-label="Preview audience">
      <button type="button" aria-pressed={audience === "public"} onClick={() => setAudience("public")}>Public profile</button>
      <button type="button" aria-pressed={audience === "club"} onClick={() => setAudience("club")}>Club display</button>
    </div> : null}
    <p className="dancer-preview-note">{onboarding ? "Tap to edit. Private until setup is complete." : `Draft preview · Approved media only. ${isPublic ? "Your saved profile is public." : "Your public profile is hidden."}`}</p>
    {audience === "public" ? <>
      <div className={onEdit ? "dancer-builder-preview-summary" : undefined}>
      <header className="dancer-preview-identity">
        {onEdit ? <button className="dancer-preview-edit-avatar" type="button" aria-label="Edit avatar" onClick={() => onEdit("dancer-face-photo")}>
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span aria-hidden="true">+</span>}
        </button> : avatarUrl ? <img src={avatarUrl} alt="Profile circle preview" /> : <span className="dancer-preview-avatar-placeholder" aria-label="Face photo missing" />}
        {onEdit ? <button className="dancer-preview-edit-identity" type="button" aria-label="Edit name and city" onClick={() => onEdit("dancer-details-section")}>
          <strong>{name || "Your stage name"}</strong><span>{city || "Your city"}</span>
        </button> : <div><h2>{name || "Your stage name"}</h2><p>{city || "Your city"}</p></div>}
      </header>
      {onEdit ? <div className="dancer-builder-card-preview">
        <button className="dancer-preview-edit-main" type="button" aria-label="Edit main photo" onClick={() => onEdit("dancer-main-photo")}>
          {main?.imageUrl ? <img src={main.imageUrl} alt="Your dancer card" /> : <span>Add main photo</span>}
          <strong>{name || "Your stage name"}</strong>
        </button>
        <span>Your dancer card</span>
      </div> : <p className="dancer-preview-note">Guests also see current club activity when available. This preview shows your profile details and media.</p>}
      </div>
      {onEdit ? <div className="dancer-builder-preview-gallery-heading"><h4>Profile gallery</h4><button type="button" onClick={() => onEdit("dancer-profile-media-library")}>Edit photos/videos</button></div> : null}
      <div className="dancer-profile-preview-overlay dancer-profile-inline-preview"><DancerPhotoCarousel stageName={name || "Your profile"}
        photos={photos.map(photo => ({ id: photo.id, imageUrl: photo.imageUrl, isPinned: photo.isPinned, isPrimary: photo.isPrimary, sortOrder: photo.sortOrder }))}
        videos={videos.filter(video => video.status === "approved" && video.videoUrl).map(video => ({ ...video, publishedAt: video.createdAt }))} /></div>
      {!main ? <p>Add profile photos to see your gallery.</p> : null}
      {!onboarding ? <details className="dancer-preview-card-example"><summary>See your discovery card</summary><div className="dancer-club-preview-card">
        {main?.imageUrl ? <img src={main.imageUrl} alt="Public discovery card preview" /> : <div className="dancer-preview-placeholder">Add a main photo</div>}
        <div><strong>{name || "Your stage name"}</strong><span>{city || "Your city"}</span></div>
      </div></details> : null}
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
