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
  const [addMedia, setAddMedia] = useState<"choose" | "photos" | "videos" | null>(null);
  useEffect(() => {
    const reveal = () => { if (/photos|details|share|visibility/.test(window.location.hash)) setView("edit"); };
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
  const additionalPhotos = photos.filter(photo => photo.id !== mainPhoto?.id && photo.id !== pendingMain?.id);
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
    : !galleryReady ? `${approvedCount} of ${MIN_DANCER_ONBOARDING_PHOTOS} profile photos approved. Add the remaining photos or review their status.` : "";
  const busy = saving || avatarBusy || mediaBusy || cropBusy || uploadBusy;
  const footerMessage = busy ? "Finishing your update…" : status || (onboarding ? "" : view === "preview"
    ? "Preview uses your draft details and approved media." : dirty ? "Details are a draft until you save." : "Uploads save individually after review.");
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

  function openEditorArea(id: string, media?: "photos" | "videos") {
    if (hasActiveUpload()) return;
    setView("edit");
    if (media) setAddMedia(media);
    window.requestAnimationFrame(() => {
      const area = root.current?.querySelector<HTMLElement>(`#${id}`);
      area?.scrollIntoView({ behavior: "smooth", block: "start" });
      area?.querySelector<HTMLElement>('input:not([type="file"]), select, button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }
  const needsDetails = dirty || !detailsSaved;
  const onboardingAction = needsDetails ? "Save details" : !faceReady ? pendingFace ? "View face photo status" : "Add face photo"
    : !mainPhoto ? "Add main photo" : !galleryReady ? "Add or review photos" : "Review agreement";
  function advanceSetup() {
    if (needsDetails || photosReady) { void save(); return; }
    if (!faceReady) openEditorArea("dancer-face-photo");
    else if (!mainPhoto) openEditorArea("dancer-main-photo");
    else openEditorArea("dancer-profile-media-library", "photos");
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
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-required-photos")}>Photos & videos</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-visibility-sharing")}>Visibility & sharing</button>
    </nav> : null}
    <fieldset disabled={busy} hidden={view !== "edit"} className="dancer-workspace-edit">
      <section className="dancer-workspace-card" id="dancer-details-section" aria-labelledby="dancer-details-title">
        <header><h3 id="dancer-details-title">Your details</h3>{onboarding ? <button className="dancer-onboarding-preview" type="button" disabled={busy} onClick={() => setView("preview")}>Preview</button> : <span className="dancer-draft-state" data-state={dirty ? "unsaved" : persistedDancerStageName(profile) ? "saved" : "required"} role="status">{dirty ? "Unsaved details" : persistedDancerStageName(profile) ? "Saved" : "Required"}</span>}</header>
        {identityContent}
        {!onboarding ? <p className="dancer-save-hint">{dirty ? "Unsaved details are kept on this device. Save to update your profile." : "Details update when you save. Photo and video uploads save separately."}</p> : null}
      </section>
      <section className="dancer-workspace-card" id="dancer-required-photos" aria-labelledby="dancer-photos-title">
        <header><h3 id="dancer-photos-title">{onboarding ? "Photos" : "Photos & videos"}</h3><span data-state={faceReady && galleryReady ? "saved" : "required"}>{onboarding ? `${approvedCount}/${MIN_DANCER_ONBOARDING_PHOTOS} approved` : `${approvedCount} approved photos`}</span></header>
        <p className="dancer-photo-guidance">{onboarding ? `A face photo + ${MIN_DANCER_ONBOARDING_PHOTOS} profile photos. Only you in each photo.` : "Use photos of yourself with one person only, including the background. Photos are checked before they appear on your profile."}</p>
        <div className="dancer-workspace-photos">
          <div className="dancer-face-photo" id="dancer-face-photo"><h4>Face photo</h4>{!onboarding ? <p>Your profile circle. Separate from your gallery photos.</p> : null}<AvatarUploadBusyContext.Provider value={setAvatarBusy}>{avatarContent}</AvatarUploadBusyContext.Provider></div>
          <div id="dancer-main-photo">{mainPhotoContent}</div>
        </div>
      </section>
      <section className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-media-library" aria-labelledby="dancer-media-title">
        <header><div><h3 id="dancer-media-title">{onboarding ? "More photos & videos" : "Profile gallery"}</h3>{!onboarding ? <p>Add more photos or optional videos anytime.</p> : null}</div><button type="button" disabled={busy} aria-expanded={addMedia !== null} onClick={() => { if (!hasActiveUpload()) setAddMedia(addMedia ? null : onboarding ? "photos" : "choose"); }}>{onboarding ? "+ Add" : "+ Add media"}</button></header>
        {addMedia ? <div className="dancer-add-media">
          {!onboarding ? <p>Photos must show only you, with no other people in the background.</p> : null}
          <div className="dancer-add-media-choices">
            <button type="button" aria-pressed={addMedia === "photos"} disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia("photos"); }}>Photo</button>
            <button type="button" aria-pressed={addMedia === "videos"} disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia("videos"); }}>Video · optional</button>
            <button type="button" disabled={busy} onClick={() => { if (!hasActiveUpload()) setAddMedia(null); }}>Done</button>
          </div>
          {addMedia === "photos" ? photoContent : addMedia === "videos" ? videoContent : <p>Choose the type of media to add.</p>}
        </div> : null}
        <DancerProfileMediaUploads compact photos={additionalPhotos} videos={uploadedVideos.map(video => ({ ...video, imageUrl: video.posterUrl }))}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={isMediaLoading} videoError={mediaError}
          disabled={cropBusy || saving || avatarBusy}
          onOpen={section => openEditorArea("dancer-profile-media-library", section)} onDeleteBusyChange={setMediaBusy}
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
      {visibilityContent}
    </fieldset>
    {view === "preview" ? <DancerProfilePreviewContent name={draftIdentity.stageName.trim()} city={draftIdentity.city}
      avatarUrl={String(profile?.avatarPhotoUrl || "")} photos={approvedPhotos} videos={uploadedVideos}
      isPublic={isPublic} onboarding={onboarding} slug={String(profile?.slug || "")} /> : null}
    <footer className="dancer-workspace-footer">
      <span role="status" aria-live="polite" hidden={!footerMessage}>{footerMessage}</span>
      {view === "edit" ? <button className="dancer-workspace-save" type="button" disabled={busy || (!onboarding && !dirty)} onClick={() => onboarding ? advanceSetup() : void save()}>{saving ? "Saving…" : onboarding ? onboardingAction : dirty ? "Save changes" : "Details saved"}</button> : <button type="button" onClick={() => setView("edit")}>Back to editing</button>}
    </footer>
  </div>;
}
