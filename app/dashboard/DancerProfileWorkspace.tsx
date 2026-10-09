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
import { mediaReviewLabel } from "@/src/lib/dancr/media-review-label";

export default function DancerProfileWorkspace({
  identityContent, avatarContent, mainPhotoContent, photoContent, videoContent,
  draftIdentity, profile, onProfileChange, onboarding = false, profileReady = false, agreementComplete = false,
  onContinue, onBusyChange, isPublic = false, uploadBusy = false, editorRequested = 0, previewRequested = 0,
}: {
  identityContent: ReactNode; avatarContent: ReactNode; mainPhotoContent: ReactNode;
  photoContent: ReactNode; videoContent: ReactNode; draftIdentity: DancerIdentityDraft;
  profile?: LoadState["profile"]; onProfileChange?: (profile: Record<string, unknown>) => void;
  uploadBusy?: boolean; editorRequested?: number; previewRequested?: number;
  onboarding?: boolean; profileReady?: boolean; agreementComplete?: boolean; onContinue?: () => void;
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
  const sourcePhotos = dancerPhotoItemsFromProfile(profile);
  const photos = relabelPhotoItems(sourcePhotos);
  const approvedPhotos = photos.filter(photo => photo.status === "approved");
  const primaryPhoto = approvedPhotos.find(photo => photo.isPrimary);
  const mainPhoto = primaryPhoto || sourcePhotos.find(photo => photo.status === "approved");
  const pendingMain = photos.find(photo => photo.isPrimary && photo.status === "pending");
  const additionalPhotos = photos.filter(photo => photo.id !== mainPhoto?.id && photo.id !== pendingMain?.id);
  const pendingReviewIds = new Set((Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).map((review: Record<string, unknown>) => String(review.id)));
  const dirty = draftIdentity.stageName.trim() !== persistedDancerStageName(profile)
    || draftIdentity.city.trim() !== String(profile?.city || "").trim();
  const detailsSaved = Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
  const pendingFace = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const faceReady = Boolean(profile?.avatarPhotoUrl);
  const photosReady = faceReady && Boolean(mainPhoto);
  const faceState = faceReady ? "Approved" : pendingFace ? mediaReviewLabel("pending", String(pendingFace.status || "pending_review")) : "Required";
  const mainState = mainPhoto ? "Approved" : pendingMain ? mediaReviewLabel(pendingMain.status, pendingMain.moderationStatus) : "Required";
  const photoBlocker = !faceReady
    ? pendingFace ? `Face photo: ${faceState.toLowerCase()}. You can choose another photo while you wait.` : "Add a clear face photo to continue."
    : !mainPhoto ? pendingMain ? `Main photo: ${mainState.toLowerCase()}. You can choose another photo while you wait.` : "Add your main photo to continue." : "";
  const nextStep = !draftIdentity.stageName.trim() || !draftIdentity.city.trim() ? "Add your stage name and city, then save your details."
    : dirty || !detailsSaved ? "Save your details to complete this step."
    : photoBlocker || (agreementComplete ? "Profile setup complete." : "Ready to review the Dancer Agreement.");
  const busy = saving || avatarBusy || mediaBusy || cropBusy || uploadBusy;
  useEffect(() => { setStatus(""); }, [faceReady, mainPhoto?.id, faceState, mainState]);
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
      setStatus(onboarding ? photoBlocker || "Details saved. Continue to the Dancer Agreement." : "Changes saved.");
      if (onboarding && photosReady) onContinue?.();
    } catch {
      if (mounted.current) setStatus("Unable to save your changes. Please try again.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div ref={root} className="dancer-profile-workspace" aria-label={onboarding ? "Create your profile" : "Edit your profile"}>
    <header className="dancer-workspace-heading">
      <div>{!onboarding && <h2>Your profile</h2>}<p>{onboarding ? "Start with your details and two photos." : "Keep your details and media up to date."}</p></div>
      <div className="dancer-workspace-view" aria-label="Profile view">
        <button type="button" aria-pressed={view === "edit"} disabled={busy} onClick={() => setView("edit")}>Edit</button>
        <button type="button" aria-pressed={view === "preview"} disabled={busy} onClick={() => setView("preview")}>Preview</button>
      </div>
    </header>
    {onboarding && view === "edit" ? <ol className="dancer-builder-checklist" aria-label="Profile setup checklist">
      {[
        { label: "Details", state: dirty ? "Unsaved" : detailsSaved ? "Saved" : "Required", complete: detailsSaved && !dirty },
        { label: "Face photo", state: faceState, complete: faceReady },
        { label: "Main photo", state: mainState, complete: Boolean(mainPhoto) },
        { label: "Agreement", state: agreementComplete ? "Accepted" : "Next", complete: agreementComplete },
      ].map(step => <li key={step.label} data-complete={step.complete}><strong>{step.complete ? <span aria-hidden="true">✓ </span> : null}{step.label}</strong><span>{step.state}</span></li>)}
    </ol> : null}
    <fieldset disabled={busy} hidden={view !== "edit"} className="dancer-workspace-edit">
      <section className="dancer-workspace-card" aria-labelledby="dancer-details-title">
        <header><h3 id="dancer-details-title">Your details</h3><span className="dancer-draft-state" data-state={dirty ? "unsaved" : persistedDancerStageName(profile) ? "saved" : "required"} role="status">{dirty ? "Unsaved details" : persistedDancerStageName(profile) ? "Saved" : "Required"}</span></header>
        {identityContent}
      </section>
      <section className="dancer-workspace-card" aria-labelledby="dancer-photos-title">
        <header><h3 id="dancer-photos-title">Your photos</h3><span data-state={profile?.avatarPhotoUrl && approvedPhotos.length ? "saved" : "required"}>{profile?.avatarPhotoUrl && approvedPhotos.length ? "Saved" : "Required"}</span></header>
        <p className="dancer-photo-guidance">Use photos of yourself with one person only, including the background. Photos are checked before they appear on your profile.</p>
        <div className="dancer-workspace-photos">
          <div className="dancer-face-photo"><h4>Face photo</h4><p>{onboarding ? "Your profile circle. Use a clear face photo." : "Your small profile circle. Use a clear photo of your face."}</p><AvatarUploadBusyContext.Provider value={setAvatarBusy}>{avatarContent}</AvatarUploadBusyContext.Provider></div>
          {mainPhotoContent}
        </div>
      </section>
      <section className="dancer-workspace-card dancer-workspace-media" aria-labelledby="dancer-media-title">
        <header><div><h3 id="dancer-media-title">More media</h3><p>{onboarding ? "Optional. Add more anytime." : "Optional. Add photos and videos whenever you’re ready."}</p></div><button type="button" disabled={busy} aria-expanded={addMedia !== null} onClick={() => { if (!hasActiveUpload()) setAddMedia(addMedia ? null : "choose"); }}>+ Add media</button></header>
        {addMedia ? <div className="dancer-add-media">
          <p>Photos must show only you, with no other people in the background.</p>
          <div className="dancer-add-media-choices">
            <button type="button" aria-pressed={addMedia === "photos"} disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia("photos"); }}>Photo</button>
            <button type="button" aria-pressed={addMedia === "videos"} disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia("videos"); }}>Video</button>
            <button type="button" disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia(null); }}>Done</button>
          </div>
          {addMedia === "photos" ? photoContent : addMedia === "videos" ? videoContent : <p>Choose the type of media to add.</p>}
        </div> : null}
        <DancerProfileMediaUploads compact photos={additionalPhotos} videos={uploadedVideos.map(video => ({ ...video, imageUrl: video.posterUrl }))}
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
          photoActions={id => {
            const photo = photos.find(item => item.id === id);
            if (!photo) return null;
            if (photo.status === "pending") {
              const reviewId = pendingReviewIds.has(photo.id) ? photo.id : undefined;
              const replacementId = reviewId
                ? approvedPhotos.find(item => Boolean(item.isPrimary) === Boolean(photo.isPrimary) && item.sortOrder === photo.sortOrder)?.id
                : photo.id;
              return <DancerSavedPhotoCrop photo={photo} pendingReviewId={reviewId} replacementPhotoId={replacementId} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} />;
            }
            return photo.status === "approved" ? <>
              <DancerSavedPhotoCrop photo={photo} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} />
              {!photo.isPrimary ? <DancerSavedPhotoCrop photo={photo} makeMain mainPhotoId={primaryPhoto?.id} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} /> : <span className="dancer-main-label">Main photo</span>}
            </> : null;
          }}
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
      <span role="status" aria-live="polite">{view === "preview" ? "Preview uses your draft details and approved media." : busy ? "Finishing your update…" : status || (onboarding ? nextStep : dirty ? "Details are a draft until you save." : "Uploads save individually after review.")}</span>
      {view === "edit" ? <button className="dancer-workspace-save" type="button" disabled={busy} onClick={() => void save()}>{saving ? "Saving…" : onboarding ? !photosReady ? "Save details" : profileReady && !dirty ? "Continue" : "Save & continue" : "Save changes"}</button> : <button type="button" onClick={() => setView("edit")}>Back to editing</button>}
    </footer>
  </div>;
}
