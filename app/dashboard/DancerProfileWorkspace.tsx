"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dancerSubmissionMedia } from "@/src/lib/dancr/dancer-submission-media";
import { MIN_DANCER_ONBOARDING_PHOTOS, approvedProfilePhotoCount } from "@/src/lib/dancr/media-limits";
import { AvatarUploadBusyContext, persistedDancerStageName, saveDancerProfileEditor } from "./DashboardShared";
import { dancerPhotoItemsFromProfile, relabelPhotoItems } from "./DancerPhotoPanel";
import DancerProfileMediaUploads from "./DancerProfileMediaUploads";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerMediaUploadRules from "./DancerMediaUploadRules";
import { useDancerProfileVideos } from "./useDancerProfileVideos";
import type { DancerIdentityDraft, LoadState } from "./dashboard-types";
import { mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { DancerProfileUploadContext, type ProfileUploadKind } from "./DancerProfileUploadContext";
import { DancerCanLeaveUploadContext, DancerPendingUploadsContext } from "./DancerUploadFeedback";
import "./dancer-profile-photos.css";
import "./dancer-profile-builder.css";
import "./dancer-unified-photos.css";

type ProfileStep = "details" | "media";
const profileSteps: { id: ProfileStep; label: string }[] = [
  { id: "details", label: "Name & city" },
  { id: "media", label: "Photos & videos" },
];

export default function DancerProfileWorkspace({
  identityContent, avatarContent, mainPhotoContent, photoContent, videoContent,
  draftIdentity, profile, onProfileChange, onboarding = false,
  onContinue, continueLabel = "Continue to agreement", onBusyChange, isPublic = false, uploadBusy = false, visibilityContent,
}: {
  identityContent: ReactNode; avatarContent: ReactNode; mainPhotoContent: ReactNode;
  photoContent: ReactNode; videoContent: ReactNode; draftIdentity: DancerIdentityDraft;
  profile?: LoadState["profile"]; onProfileChange?: (profile: Record<string, unknown>) => void;
  uploadBusy?: boolean;
  onboarding?: boolean; profileReady?: boolean; agreementComplete?: boolean; onContinue?: () => void; continueLabel?: string;
  onBusyChange?: (busy: boolean) => void; isPublic?: boolean;
  visibilityContent?: ReactNode;
}) {
  const [step, setStep] = useState<ProfileStep>("details");
  const [uploadKind, setUploadKind] = useState<ProfileUploadKind | null>(null);
  const openUpload = useCallback((kind: ProfileUploadKind) => setUploadKind(kind), []);
  useEffect(() => {
    const reveal = () => {
      const hash = window.location.hash;
      if (!/photo|video|media|details|share|visibility/.test(hash)) return;
      if (onboarding) {
        setStep(/details/.test(hash) ? "details" : "media");
      }
      if (/video/.test(hash)) setUploadKind("videos");
      else if (/photo|media-library/.test(hash)) setUploadKind("photos");
      if (["#dancer-photos-title", "#dancer-videos-title", "#dancer-required-photos", "#dancer-main-photo", "#dancer-face-photo"].includes(hash)) {
        const targetId = hash === "#dancer-videos-title" ? "dancer-builder-video-upload"
          : hash === "#dancer-photos-title" ? "dancer-profile-media-library" : hash.slice(1);
        window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`#${targetId}`)?.scrollIntoView({ block: "start" }));
      }
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [onboarding]);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<Record<string, boolean>>({});
  const reportPendingUploads = useCallback((kind: string, pending: boolean) => {
    setPendingUploads(current => Boolean(current[kind]) === pending ? current : { ...current, [kind]: pending });
  }, []);
  const [status, setStatus] = useState("");
  useEffect(() => { setStatus(""); }, [draftIdentity.stageName, draftIdentity.city]);
  const root = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const { uploadedVideos, setUploadedVideos, isMediaLoading, mediaError } = useDancerProfileVideos(profile?.id);
  const sourcePhotos = dancerPhotoItemsFromProfile(profile);
  const photos = relabelPhotoItems(sourcePhotos);
  const approvedPhotos = photos.filter(photo => photo.status === "approved").sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
  const primaryPhoto = approvedPhotos.find(photo => photo.isPrimary);
  const mainPhoto = primaryPhoto;
  const pendingMain = photos.find(photo => photo.isPrimary && photo.status === "pending");
  const pendingReviewIds = new Set((Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).map((review: Record<string, unknown>) => String(review.id)));
  const dirty = draftIdentity.stageName.trim() !== persistedDancerStageName(profile)
    || draftIdentity.city.trim() !== String(profile?.city || "").trim();
  const detailsSaved = Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
  const pendingFace = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const faceReady = Boolean(profile?.avatarPhotoUrl);
  const approvedCount = approvedProfilePhotoCount(photos);
  const submittedMedia = dancerSubmissionMedia(profile);
  const galleryReady = submittedMedia.count >= MIN_DANCER_ONBOARDING_PHOTOS;
  const photosReady = submittedMedia.hasMain && galleryReady;
  const faceState = faceReady ? "Approved" : pendingFace ? mediaReviewLabel("pending", String(pendingFace.status || "pending_review")) : "Required";
  const mainState = mainPhoto ? "Approved" : pendingMain ? mediaReviewLabel(pendingMain.status, pendingMain.moderationStatus) : "Required";
  const photoBlocker = !submittedMedia.hasMain ? "Add your main photo to continue."
    : !galleryReady ? `Add ${MIN_DANCER_ONBOARDING_PHOTOS - submittedMedia.count} more profile photo${MIN_DANCER_ONBOARDING_PHOTOS - submittedMedia.count === 1 ? "" : "s"}. Pending uploads count toward setup.` : "";
  const identityHint = draftIdentity.stageName.trim().length < 2 ? "Enter your stage name."
    : !draftIdentity.city.trim() ? "Choose your city." : "";
  const setupHint = identityHint || (step === "details" ? "" : photoBlocker);
  const busy = saving || avatarBusy || mediaBusy || cropBusy || uploadBusy;
  const footerMessage = busy ? "Finishing your update…" : status || (onboarding ? setupHint : "");
  const stepStorageKey = `mydancr:dancer-profile-builder:${String(profile?.id || "profile")}`;
  const restoredProfile = useRef("");
  useEffect(() => {
    if (!onboarding || !profile?.id || restoredProfile.current === stepStorageKey) return;
    restoredProfile.current = stepStorageKey;
    let savedStep = "";
    try { savedStep = window.localStorage.getItem(stepStorageKey) || ""; } catch { /* Storage can be unavailable. */ }
    const hash = window.location.hash;
    // Retired preview progress resumes at media, with all requirements checked again.
    setStep(!detailsSaved || /details/.test(hash) ? "details" : /photo|video|media/.test(hash) ? "media" : savedStep === "details" ? "details" : "media");
  }, [onboarding, profile?.id, stepStorageKey, detailsSaved]);
  useEffect(() => { setStatus(""); }, [faceReady, mainPhoto?.id, faceState, mainState, approvedCount]);
  // Upload panels expose their own busy state; retain them while switching steps.
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

  function showStep(next: ProfileStep) {
    setStep(next); setStatus("");
    try { window.localStorage.setItem(stepStorageKey, next); } catch { /* Saving the profile still works. */ }
    window.requestAnimationFrame(() => {
      const heading = root.current?.querySelector<HTMLElement>("#dancer-builder-title");
      heading?.scrollIntoView({ behavior: "smooth", block: "start" });
      heading?.focus({ preventScroll: true });
    });
  }

  function openEditorArea(id: string) {
    if (hasActiveUpload()) return;
    if (onboarding) {
      showStep(id === "dancer-details-section" ? "details" : "media");
    }
    if (["dancer-profile-media-library", "dancer-required-photos", "dancer-main-photo", "dancer-face-photo"].includes(id)) setUploadKind("photos");
    if (id === "dancer-profile-video-library") setUploadKind("videos");
    window.requestAnimationFrame(() => {
      const targetId = id === "dancer-profile-video-library" ? "dancer-builder-video-upload" : id;
      const area = root.current?.querySelector<HTMLElement>(`#${targetId}`);
      const uploader = area?.querySelector<HTMLDetailsElement>('details[data-profile-upload]');
      if (uploader) uploader.open = true;
      area?.scrollIntoView({ behavior: "smooth", block: "start" });
      area?.querySelector<HTMLElement>('input:not([type="file"]), select, button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }
  const needsDetails = dirty || !detailsSaved;
  function advanceSetup() {
    if (savingRef.current || hasActiveUpload()) return;
    if (step === "details") { void save("media"); return; }
    if (identityHint) { showStep("details"); setStatus(identityHint); return; }
    if (!photosReady) { revealMissingPhoto(); setStatus(photoBlocker); return; }
    void save("continue");
  }
  function chooseStep(next: ProfileStep) {
    if (savingRef.current || hasActiveUpload() || next === step) return;
    if (next === "details") { showStep(next); return; }
    if (needsDetails) { void save(next); return; }
    showStep(next);
  }
  function revealMissingPhoto() {
    if (!submittedMedia.hasMain) openEditorArea("dancer-main-photo");
    else openEditorArea("dancer-profile-media-library");
  }

  async function save(next?: ProfileStep | "continue") {
    if (savingRef.current || hasActiveUpload()) return;
    if (onboarding && identityHint) { showStep("details"); setStatus(identityHint); return; }
    const form = root.current?.querySelector<HTMLFormElement>(".dancer-profile-identity-form");
    if (onboarding && step !== "details" && form?.checkValidity?.() === false) {
      showStep("details"); setStatus("Check your name and city, then try again."); return;
    }
    if (form && !form.reportValidity()) return;
    savingRef.current = true;
    setSaving(true); setStatus("");
    try {
      const saved = await saveDancerProfileEditor();
      if (!mounted.current) return;
      if (!saved) { if (onboarding) showStep("details"); setStatus("Check your name and city, then try again."); return; }
      setStatus(onboarding ? "" : "Changes saved.");
      if (onboarding) {
        if (next === "continue" && photosReady) onContinue?.();
        else showStep("media");
      }
    } catch {
      if (mounted.current) setStatus("Unable to save your changes. Please try again.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div ref={root} className="dancer-profile-workspace" data-media-layout="shared" data-onboarding={onboarding || undefined} data-builder-step={onboarding ? step : undefined} aria-label={onboarding ? "Create your profile" : "Edit your profile"}>
    <AvatarUploadBusyContext.Provider value={setAvatarBusy}>
    <DancerPendingUploadsContext.Provider value={reportPendingUploads}>
    <DancerCanLeaveUploadContext.Provider value={!busy && !dirty && !Object.values(pendingUploads).some(Boolean)}>
    {onboarding ? <>
      <nav className="dancer-builder-steps" aria-label="Profile setup steps">
        {profileSteps.map((item, index) => <button type="button" key={item.id} aria-current={step === item.id ? "step" : undefined}
          disabled={busy} onClick={() => chooseStep(item.id)}>
          <span aria-hidden="true">{index + 1}</span>{item.label}
        </button>)}
      </nav>
      <header className="dancer-builder-heading">
        <h3 id="dancer-builder-title" tabIndex={-1}>{step === "details" ? "Name & city" : "Build your profile"}</h3>
        {step === "media" ? <span className="dancer-builder-requirement" data-state={photosReady ? "saved" : "required"} role="status">{!mainPhoto ? "Add main photo" : galleryReady && faceReady ? "Photos ready" : `${approvedCount} of ${MIN_DANCER_ONBOARDING_PHOTOS} photos approved`}</span> : null}
      </header>
    </> : null}
    {!onboarding ? <header className="dancer-workspace-heading">
      <div><h2>Your profile</h2><p>Manage your details, media, and visibility.</p></div>
    </header> : null}
    {!onboarding ? <nav className="dancer-editor-shortcuts" aria-label="Profile sections">
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-details-section")}>Details</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-profile-media-library")}>Photos</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-profile-video-library")}>Videos</button>
      <button type="button" disabled={busy} onClick={() => openEditorArea("dancer-visibility-sharing")}>Visibility & sharing</button>
    </nav> : null}
    <DancerProfileUploadContext.Provider value={{ active: uploadKind, open: openUpload }}>
    <fieldset disabled={saving} className="dancer-workspace-edit">
      <section hidden={onboarding && step !== "details"} className="dancer-workspace-card" id="dancer-details-section" aria-label={onboarding ? "Name and city" : undefined} aria-labelledby={onboarding ? undefined : "dancer-details-title"}>
        {!onboarding ? <header><h3 id="dancer-details-title">Your details</h3></header> : null}
        {identityContent}
      </section>
      <div className="dancer-profile-media-area" hidden={onboarding && step !== "media"}>
      <section hidden={onboarding && step !== "media"} className="dancer-builder-upload-entry" aria-label="Add profile media">
        <button type="button" aria-pressed={uploadKind === "photos"} aria-controls="dancer-profile-media-library" disabled={busy} onClick={() => setUploadKind(current => current === "photos" ? null : "photos")}>+ Photos</button>
        <button type="button" aria-pressed={uploadKind === "videos"} aria-controls="dancer-profile-video-library" disabled={busy} onClick={() => setUploadKind(current => current === "videos" ? null : "videos")}>+ Videos</button>
      </section>
      <section hidden={(onboarding && step !== "media") || uploadKind === "videos"} className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-media-library" aria-label="Photo uploads and library">
        <section hidden={uploadKind !== "photos"} className="dancer-workspace-card dancer-profile-photos" id="dancer-required-photos" aria-label="Main photo and automatic avatar">
          <div className="dancer-profile-photo-slot dancer-workspace-main-photo" id="dancer-main-photo" role="group" aria-labelledby="dancer-main-upload-title">
            <h4 id="dancer-main-upload-title">Main photo</h4>
            <p className="dancer-photo-guidance">For your card and profile.</p>
            {mainPhotoContent}
          </div>
          <div className="dancer-profile-photo-slot dancer-face-photo" id="dancer-face-photo" role="group" aria-labelledby="dancer-face-photo-title">
            <h4 id="dancer-face-photo-title">Avatar</h4>
            <p className="dancer-photo-guidance">Created automatically.</p>
            {avatarContent}
          </div>
          <DancerMediaUploadRules kind="photo" />
        </section>
        <div className="dancer-section-uploader">{photoContent}</div>
        <DancerProfileMediaUploads compact expanded mediaType="photos" photos={approvedPhotos} videos={[]}
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
      </section>
      <section hidden={(onboarding && step !== "media") || uploadKind === "photos"} className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-video-library" aria-label="Video uploads and library">
        <div className="dancer-section-uploader dancer-builder-video-uploader" id="dancer-builder-video-upload">{videoContent}</div>
        <DancerProfileMediaUploads compact expanded mediaType="videos" photos={[]} videos={uploadedVideos.filter(video => video.status === "approved").map(video => ({ ...video, imageUrl: video.posterUrl }))}
          onProfileChange={onProfileChange}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={isMediaLoading} videoError={mediaError}
          disabled={cropBusy || saving || avatarBusy}
          onOpen={() => openEditorArea("dancer-profile-video-library")} onDeleteBusyChange={setMediaBusy}
          onPhotoDeleted={() => {}}
          onVideoDeleted={id => setUploadedVideos(current => current.filter(video => video.id !== id))}
          onMediaPinned={(_kind, id, pinned) => setUploadedVideos(current => current.map(video => video.id === id ? { ...video, isPinned: pinned } : video))}
        />
      </section>
      </div>
      {visibilityContent}
    </fieldset>
    </DancerProfileUploadContext.Provider>
    <footer className="dancer-workspace-footer" hidden={!onboarding && !dirty && !saving}>
      <span id="dancer-workspace-next-step" role="status" aria-live="polite" hidden={!footerMessage}>{footerMessage}</span>
      <button className="dancer-workspace-save" type="button" aria-describedby={footerMessage ? "dancer-workspace-next-step" : undefined} disabled={busy || (!onboarding && !dirty)} onClick={() => onboarding ? advanceSetup() : void save()}>{saving ? "Saving…" : onboarding ? step === "media" ? continueLabel : "Continue" : "Save changes"}</button>
      {onboarding && step !== "details" ? <button className="dancer-builder-back" type="button" disabled={busy} onClick={() => chooseStep("details")}>Back</button> : null}
    </footer>
    </DancerCanLeaveUploadContext.Provider>
    </DancerPendingUploadsContext.Provider>
    </AvatarUploadBusyContext.Provider>
  </div>;
}
