"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import DancerProfilePreviewContent from "./DancerProfilePreviewContent";
import { MIN_DANCER_ONBOARDING_PHOTOS, approvedProfilePhotoCount } from "@/src/lib/dancr/media-limits";
import { AvatarUploadBusyContext, persistedDancerStageName, saveDancerProfileEditor } from "./DashboardShared";
import { dancerPhotoItemsFromProfile, relabelPhotoItems } from "./DancerPhotoPanel";
import DancerProfileMediaUploads from "./DancerProfileMediaUploads";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerInternalMainPhotoPicker from "./DancerInternalMainPhotoPicker";
import { useDancerProfileVideos } from "./useDancerProfileVideos";
import type { DancerIdentityDraft, LoadState } from "./dashboard-types";
import { mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import "./dancer-profile-photos.css";

export default function DancerProfileWorkspace({
  identityContent, avatarContent, mainPhotoContent, photoContent, videoContent,
  draftIdentity, profile, onProfileChange, onboarding = false,
  onContinue, onBusyChange, isPublic = false, uploadBusy = false, editorRequested = 0, previewRequested = 0, visibilityContent,
}: {
  identityContent: ReactNode; avatarContent: ReactNode; mainPhotoContent: ReactNode;
  photoContent: ReactNode; videoContent: ReactNode; draftIdentity: DancerIdentityDraft;
  profile?: LoadState["profile"]; onProfileChange?: (profile: Record<string, unknown>) => void;
  uploadBusy?: boolean; editorRequested?: number; previewRequested?: number;
  onboarding?: boolean; profileReady?: boolean; agreementComplete?: boolean; onContinue?: () => void;
  onBusyChange?: (busy: boolean) => void; isPublic?: boolean;
  visibilityContent?: ReactNode;
}) {
  const [view, setView] = useState<"edit" | "preview">("edit");
  useEffect(() => { if (editorRequested) setView("edit"); }, [editorRequested]);
  useEffect(() => { if (previewRequested) setView("preview"); }, [previewRequested]);
  useEffect(() => {
    const reveal = () => { if (/photos|video|media|details|share|visibility/.test(window.location.hash)) setView("edit"); };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
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
  const additionalPhotos = approvedPhotos.filter(photo => photo.id !== mainPhoto?.id);
  const pendingReviewIds = new Set((Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).map((review: Record<string, unknown>) => String(review.id)));
  const dirty = draftIdentity.stageName.trim() !== persistedDancerStageName(profile)
    || draftIdentity.city.trim() !== String(profile?.city || "").trim();
  const detailsSaved = Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
  const pendingFace = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const faceReady = Boolean(profile?.avatarPhotoUrl);
  const approvedCount = approvedProfilePhotoCount(photos);
  const galleryReady = approvedCount >= MIN_DANCER_ONBOARDING_PHOTOS;
  const photosReady = faceReady && galleryReady;
  const faceState = faceReady ? "Approved" : pendingFace ? mediaReviewLabel("pending", String(pendingFace.status || "pending_review")) : "Required";
  const mainState = mainPhoto ? "Approved" : pendingMain ? mediaReviewLabel(pendingMain.status, pendingMain.moderationStatus) : "Required";
  const photoBlocker = !faceReady
    ? pendingFace ? `Face photo: ${faceState.toLowerCase()}. You can choose another photo while you wait.` : "Add a clear face photo to continue."
    : !mainPhoto ? pendingMain ? `Main photo: ${mainState.toLowerCase()}. You can choose another photo while you wait.` : "Add your main photo to continue."
    : !galleryReady ? `Add ${MIN_DANCER_ONBOARDING_PHOTOS - approvedCount} more approved profile photo${MIN_DANCER_ONBOARDING_PHOTOS - approvedCount === 1 ? "" : "s"}.` : "";
  const setupHint = draftIdentity.stageName.trim().length < 2 ? "Enter your stage name."
    : !draftIdentity.city.trim() ? "Choose your city." : photoBlocker;
  const busy = saving || avatarBusy || mediaBusy || cropBusy || uploadBusy;
  const footerMessage = busy ? "Finishing your update…" : status || (view === "preview"
    ? "Preview uses your draft details and approved media." : onboarding ? setupHint : "");
  useEffect(() => { setStatus(""); }, [faceReady, mainPhoto?.id, faceState, mainState, approvedCount]);
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

  function openEditorArea(id: string) {
    if (hasActiveUpload()) return;
    setView("edit");
    window.requestAnimationFrame(() => {
      const area = root.current?.querySelector<HTMLElement>(`#${id}`);
      const uploader = area?.querySelector<HTMLDetailsElement>('details[data-profile-upload]');
      if (uploader) uploader.open = true;
      area?.scrollIntoView({ behavior: "smooth", block: "start" });
      area?.querySelector<HTMLElement>('input:not([type="file"]), select, button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }
  const needsDetails = dirty || !detailsSaved;
  function advanceSetup() {
    if (needsDetails || photosReady) { void save(); return; }
    setStatus(photoBlocker);
    revealMissingPhoto();
  }
  function revealMissingPhoto() {
    if (!faceReady) openEditorArea("dancer-face-photo");
    else if (!mainPhoto) openEditorArea("dancer-main-photo");
    else openEditorArea("dancer-profile-media-library");
  }

  async function save() {
    if (savingRef.current || hasActiveUpload()) return;
    const form = root.current?.querySelector<HTMLFormElement>(".dancer-profile-identity-form");
    if (form && !form.reportValidity()) return;
    savingRef.current = true;
    setSaving(true); setStatus("");
    try {
      const saved = await saveDancerProfileEditor();
      if (!mounted.current) return;
      if (!saved) { setStatus("Check your name and city, then try again."); return; }
      setStatus(onboarding ? photoBlocker || "Details saved. Continue to the Dancer Agreement." : "Changes saved.");
      if (onboarding) {
        if (photosReady) onContinue?.();
        else revealMissingPhoto();
      }
    } catch {
      if (mounted.current) setStatus("Unable to save your changes. Please try again.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div ref={root} className="dancer-profile-workspace" data-onboarding={onboarding || undefined} aria-label={onboarding ? "Create your profile" : "Edit your profile"}>
    {!onboarding ? <header className="dancer-workspace-heading">
      <div><h2>Your profile</h2><p>Manage your details, media, and visibility.</p></div>
      <div className="dancer-workspace-view" aria-label="Profile view">
        <button type="button" aria-pressed={view === "edit"} disabled={busy} onClick={() => setView("edit")}>Edit</button>
        <button type="button" aria-pressed={view === "preview"} disabled={busy} onClick={() => setView("preview")}>Preview</button>
      </div>
    </header> : null}
    {!onboarding && view === "edit" ? <nav className="dancer-editor-shortcuts" aria-label="Profile sections">
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-details-section")}>Details</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-required-photos")}>Profile photos</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-profile-media-library")}>Photo uploads</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-profile-video-library")}>Videos</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-visibility-sharing")}>Visibility & sharing</button>
    </nav> : null}
    <fieldset disabled={busy} hidden={view !== "edit"} className="dancer-workspace-edit">
      <section className="dancer-workspace-card" id="dancer-details-section" aria-labelledby="dancer-details-title">
        <header><h3 id="dancer-details-title">Your details</h3>{onboarding ? <button className="dancer-onboarding-preview" type="button" disabled={busy} onClick={() => setView("preview")}>Preview</button> : null}</header>
        {identityContent}
      </section>
      <section className="dancer-workspace-card dancer-profile-photos" id="dancer-required-photos" aria-labelledby="dancer-profile-photos-title">
        <header><h3 id="dancer-profile-photos-title">Profile photos</h3></header>
        <div className="dancer-profile-photo-slot dancer-face-photo" id="dancer-face-photo" role="group" aria-labelledby="dancer-face-photo-title">
          <h4 id="dancer-face-photo-title">Avatar</h4>
          <p className="dancer-photo-guidance">Tap to edit your profile circle.</p>
          <AvatarUploadBusyContext.Provider value={setAvatarBusy}>{avatarContent}</AvatarUploadBusyContext.Provider>
        </div>
        <div className="dancer-profile-photo-slot dancer-workspace-main-photo" id="dancer-main-photo" role="group" aria-labelledby="dancer-main-upload-title">
          <h4 id="dancer-main-upload-title">Main photo</h4>
          <p className="dancer-photo-guidance">Tap to edit your dancer card.</p>
          {mainPhotoContent}
        </div>
      </section>
      <section className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-media-library" aria-labelledby="dancer-photos-title">
        <header><h3 id="dancer-photos-title">Photo uploads</h3><span data-state={galleryReady ? "saved" : "required"}>{onboarding && !galleryReady ? `${approvedCount} of ${MIN_DANCER_ONBOARDING_PHOTOS} approved` : `${approvedCount} approved`}</span></header>
        <p className="dancer-photo-guidance">{onboarding && !galleryReady ? `Main photo + ${MIN_DANCER_ONBOARDING_PHOTOS - 1} more. Only you in each photo.` : "Add more photos if you like. Only you in each photo."}</p>
        <div className="dancer-section-uploader">{photoContent}</div>
        <DancerProfileMediaUploads compact mediaType="photos" photos={additionalPhotos} videos={[]}
          onProfileChange={onProfileChange}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={false} videoError=""
          disabled={cropBusy || saving || avatarBusy}
          onOpen={() => openEditorArea("dancer-profile-media-library")} onDeleteBusyChange={setMediaBusy}
          onPhotoDeleted={id => onProfileChange?.({ ...profile,
            dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).filter((photo: Record<string, unknown>) => photo.id !== id),
            pending_photo_reviews: (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).filter((photo: Record<string, unknown>) => photo.id !== id),
          })}
          onVideoDeleted={() => {}}
          onMediaPinned={(_kind, id, pinned) => onProfileChange?.({ ...profile, dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).map((photo: Record<string, unknown>) => photo.id === id ? { ...photo, is_pinned: pinned } : photo) })}
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
      <section className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-video-library" aria-labelledby="dancer-videos-title">
        <header><h3 id="dancer-videos-title">Video uploads</h3></header>
        <div className="dancer-section-uploader">{videoContent}</div>
        <DancerProfileMediaUploads compact mediaType="videos" photos={[]} videos={uploadedVideos.filter(video => video.status === "approved").map(video => ({ ...video, imageUrl: video.posterUrl }))}
          onProfileChange={onProfileChange}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={isMediaLoading} videoError={mediaError}
          disabled={cropBusy || saving || avatarBusy}
          onOpen={() => openEditorArea("dancer-profile-video-library")} onDeleteBusyChange={setMediaBusy}
          onPhotoDeleted={() => {}}
          onVideoDeleted={id => setUploadedVideos(current => current.filter(video => video.id !== id))}
          onMediaPinned={(_kind, id, pinned) => setUploadedVideos(current => current.map(video => video.id === id ? { ...video, isPinned: pinned } : video))}
        />
      </section>
      {visibilityContent}
    </fieldset>
    {view === "preview" ? <DancerProfilePreviewContent name={draftIdentity.stageName.trim()} city={draftIdentity.city}
      avatarUrl={String(profile?.avatarPhotoUrl || "")} photos={approvedPhotos} videos={uploadedVideos}
      isPublic={isPublic} onboarding={onboarding} slug={String(profile?.slug || "")} /> : null}
    <footer className="dancer-workspace-footer">
      <span id="dancer-workspace-next-step" role="status" aria-live="polite" hidden={!footerMessage}>{footerMessage}</span>
      {view === "edit" ? <button className="dancer-workspace-save" type="button" aria-describedby={footerMessage ? "dancer-workspace-next-step" : undefined} disabled={busy || (!onboarding && !dirty)} onClick={() => onboarding ? advanceSetup() : void save()}>{saving ? "Saving…" : onboarding ? "Continue" : dirty ? "Save changes" : "Details saved"}</button> : <button type="button" onClick={() => setView("edit")}>Back to editing</button>}
    </footer>
  </div>;
}
