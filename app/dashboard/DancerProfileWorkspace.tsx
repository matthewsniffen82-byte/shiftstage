"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DancerPhotoCarousel } from "@/app/dancers/[slug]/DancerPhotoCarousel";
import { AvatarUploadBusyContext, persistedDancerStageName, saveDancerProfileEditor } from "./DashboardShared";
import { dancerPhotoItemsFromProfile, relabelPhotoItems } from "./DancerPhotoPanel";
import DancerProfileMediaUploads from "./DancerProfileMediaUploads";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerInternalMainPhotoPicker from "./DancerInternalMainPhotoPicker";
import { useDancerProfileVideos } from "./useDancerProfileVideos";
import type { DancerIdentityDraft, LoadState } from "./dashboard-types";

export default function DancerProfileWorkspace({
  identityContent, avatarContent, mainPhotoContent, photoContent, videoContent,
  draftIdentity, profile, onProfileChange, onboarding = false, profileReady = false,
  onContinue, onBusyChange, isPublic = false, uploadBusy = false, editorRequested = 0, previewRequested = 0,
}: {
  identityContent: ReactNode; avatarContent: ReactNode; mainPhotoContent: ReactNode;
  photoContent: ReactNode; videoContent: ReactNode; draftIdentity: DancerIdentityDraft;
  profile?: LoadState["profile"]; onProfileChange?: (profile: Record<string, unknown>) => void;
  uploadBusy?: boolean; editorRequested?: number; previewRequested?: number;
  onboarding?: boolean; profileReady?: boolean; onContinue?: () => void;
  onBusyChange?: (busy: boolean) => void; isPublic?: boolean;
}) {
  const [view, setView] = useState<"edit" | "preview">("edit");
  useEffect(() => { if (editorRequested) setView("edit"); }, [editorRequested]);
  useEffect(() => { if (previewRequested) setView("preview"); }, [previewRequested]);
  const [addMedia, setAddMedia] = useState<"choose" | "photos" | "videos" | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => { setStatus(""); }, [draftIdentity.stageName, draftIdentity.city]);
  const root = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const { uploadedVideos, setUploadedVideos, isMediaLoading, mediaError } = useDancerProfileVideos(profile?.id);
  const photos = relabelPhotoItems(dancerPhotoItemsFromProfile(profile));
  const approvedPhotos = photos.filter(photo => photo.status === "approved");
  const primaryPhoto = approvedPhotos.find(photo => photo.isPrimary);
  const mainPhoto = primaryPhoto || approvedPhotos[0];
  const dirty = draftIdentity.stageName.trim() !== persistedDancerStageName(profile)
    || draftIdentity.city.trim() !== String(profile?.city || "").trim();
  const busy = saving || avatarBusy || mediaBusy || cropBusy || uploadBusy;
  // Upload panels expose their own busy state; retain them while switching views.
  const hasActiveUpload = () => busy || Boolean(root.current?.querySelector('[aria-busy="true"]'));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const reportCropBusy = useCallback((value: boolean) => setCropBusy(value), []);

  async function save() {
    if (savingRef.current || hasActiveUpload()) return;
    const form = root.current?.querySelector<HTMLFormElement>(".dancer-profile-identity-form");
    if (form && !form.reportValidity()) return;
    savingRef.current = true;
    setSaving(true); setStatus("");
    try {
      const saved = await saveDancerProfileEditor();
      if (!mounted.current) return;
      if (!saved) { setStatus("Check your details below and try saving again."); return; }
      setStatus(onboarding ? "Details saved. Complete the required photos, then review your agreement below." : "Changes saved.");
      if (onboarding) onContinue?.();
    } catch {
      if (mounted.current) setStatus("Unable to save your changes. Please try again.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div ref={root} className="dancer-profile-workspace" aria-label={onboarding ? "Create your profile" : "Edit your profile"}>
    <header className="dancer-workspace-heading">
      <div><h2>{onboarding ? "Make it yours" : "Your profile"}</h2><p>{onboarding ? "Start with your details and two photos." : "Keep your details and media up to date."}</p></div>
      <div className="dancer-workspace-view" aria-label="Profile view">
        <button type="button" aria-pressed={view === "edit"} disabled={busy} onClick={() => setView("edit")}>Edit</button>
        <button type="button" aria-pressed={view === "preview"} disabled={busy} onClick={() => setView("preview")}>Preview</button>
      </div>
    </header>
    <fieldset disabled={busy} hidden={view !== "edit"} className="dancer-workspace-edit">
      <section className="dancer-workspace-card" aria-labelledby="dancer-details-title">
        <header><h3 id="dancer-details-title">Your details</h3><span className="dancer-draft-state" role="status">{dirty ? "Unsaved details" : persistedDancerStageName(profile) ? "Saved" : "Required"}</span></header>
        {identityContent}
      </section>
      <section className="dancer-workspace-card" aria-labelledby="dancer-photos-title">
        <header><h3 id="dancer-photos-title">Your photos</h3><span>{profile?.avatarPhotoUrl && approvedPhotos.length ? "Saved" : "Required"}</span></header>
        <div className="dancer-workspace-photos">
          <div className="dancer-face-photo"><h4>Face photo</h4><p>Your small profile circle. Use a clear photo of your face.</p><AvatarUploadBusyContext.Provider value={setAvatarBusy}>{avatarContent}</AvatarUploadBusyContext.Provider></div>
          {mainPhotoContent}
        </div>
      </section>
      <section className="dancer-workspace-card dancer-workspace-media" aria-labelledby="dancer-media-title">
        <header><div><h3 id="dancer-media-title">More media</h3><p>Optional. Add photos and videos whenever you’re ready.</p></div><button type="button" disabled={busy} aria-expanded={addMedia !== null} onClick={() => { if (!hasActiveUpload()) setAddMedia(addMedia ? null : "choose"); }}>+ Add media</button></header>
        {addMedia ? <div className="dancer-add-media">
          <div className="dancer-add-media-choices">
            <button type="button" aria-pressed={addMedia === "photos"} disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia("photos"); }}>Photo</button>
            <button type="button" aria-pressed={addMedia === "videos"} disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia("videos"); }}>Video</button>
            <button type="button" disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia(null); }}>Done</button>
          </div>
          {addMedia === "photos" ? photoContent : addMedia === "videos" ? videoContent : <p>Choose the type of media to add.</p>}
        </div> : null}
        <DancerProfileMediaUploads compact photos={photos} videos={uploadedVideos.map(video => ({ ...video, imageUrl: video.posterUrl }))}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={isMediaLoading} videoError={mediaError}
          disabled={cropBusy || saving || avatarBusy}
          onOpen={setAddMedia} onDeleteBusyChange={setMediaBusy}
          onPhotoDeleted={id => onProfileChange?.({ ...profile,
            dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).filter((photo: Record<string, unknown>) => photo.id !== id),
            pending_photo_reviews: (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).filter((photo: Record<string, unknown>) => photo.id !== id),
          })}
          onVideoDeleted={id => setUploadedVideos(current => current.filter(video => video.id !== id))}
          onMediaPinned={(kind, id, pinned) => {
            if (kind === "video") setUploadedVideos(current => current.map(video => video.id === id ? { ...video, isPinned: pinned } : video));
            else onProfileChange?.({ ...profile, dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).map((photo: Record<string, unknown>) => photo.id === id ? { ...photo, is_pinned: pinned } : photo) });
          }}
          photoActions={id => { const photo = approvedPhotos.find(item => item.id === id); return photo ? <>
            <DancerSavedPhotoCrop photo={photo} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} />
            {!photo.isPrimary ? <DancerSavedPhotoCrop photo={photo} makeMain mainPhotoId={primaryPhoto?.id} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} /> : <span className="dancer-main-label">Main photo</span>}
          </> : null; }}
        />
        {approvedPhotos.length > 1 ? <DancerInternalMainPhotoPicker photos={photos} disabled={busy} onProfileChange={onProfileChange} /> : null}
      </section>
    </fieldset>
    {view === "preview" ? <section className="dancer-workspace-preview" aria-label="Profile preview">
      <p className="dancer-preview-note">Preview · Only approved media is shown. Guest activity and club details appear when available.</p>
      <div className="dancer-preview-hero">
        <div className="dancer-preview-copy"><span className="eyebrow">Your profile</span><h2>{draftIdentity.stageName.trim() || "Your stage name"}</h2><p>{draftIdentity.city || "Your city"}</p><span>{isPublic ? "Public profile" : onboarding ? "Not public yet" : "Incognito"}</span></div>
        {mainPhoto?.imageUrl ? <img src={mainPhoto.imageUrl} alt="Main profile photo preview" /> : <div className="dancer-preview-placeholder">Add your main photo</div>}
      </div>
      <div className="dancer-profile-preview-overlay dancer-profile-inline-preview"><DancerPhotoCarousel stageName={draftIdentity.stageName || "Your profile"} photos={approvedPhotos.map(photo => ({ id: photo.id, imageUrl: photo.imageUrl, isPinned: photo.isPinned }))} videos={uploadedVideos.filter(video => video.status === "approved" && video.videoUrl).map(video => ({ ...video, publishedAt: video.createdAt }))} /></div>
    </section> : null}
    <footer className="dancer-workspace-footer">
      <span role="status" aria-live="polite">{view === "preview" ? "Preview uses your draft details and approved media." : status || (busy ? "Finishing your update…" : dirty ? "Details are a draft until you save." : "Uploads save individually after review.")}</span>
      {view === "edit" ? <button className="dancer-workspace-save" type="button" disabled={busy} onClick={() => void save()}>{saving ? "Saving…" : onboarding ? profileReady && !dirty ? "Continue" : "Save & continue" : "Save changes"}</button> : <button type="button" onClick={() => setView("edit")}>Back to editing</button>}
    </footer>
  </div>;
}
