"use client";
import { useDashboardHelpArea } from "../components/dashboard-help-scope";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dancerSubmissionMedia, dancerSubmissionVideoCount } from "@/src/lib/dancr/dancer-submission-media";
import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "@/src/lib/dancr/media-limits";
import { AvatarUploadBusyContext, persistedDancerStageName, saveDancerProfileEditor } from "./DashboardShared";
import { dancerPhotoItemsFromProfile, rejectedPhotoItemsFromProfile, relabelPhotoItems } from "./DancerPhotoPanel";
import DancerProfileMediaUploads from "./DancerProfileMediaUploads";
import { mergeMediaLibraryItems, type MediaLibraryItem } from "./media-library-items";
import DancerMediaLibrarySection from "./DancerMediaLibrarySection";
import { mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { clubPreviewMedia, mediaClubStatuses, mediaClubItemLabel, mediaClubRejection, selectedClubMediaRows, type ClubMediaState } from "@/src/lib/dancr/club-media-status";
import { setDancerMediaEditorVenue } from "./dashboard-session";
import DancerMediaClubView from "./DancerMediaClubView";
import { dancerAvatarPreview } from "./dancer-avatar-preview";
import DancerSavedPhotoCrop from "./DancerSavedPhotoCrop";
import DancerChooseMainPhoto from "./DancerChooseMainPhoto";
import DancerMediaReviewOutcome from "./DancerMediaReviewOutcome";
import DancerMediaBatchSubmission from "./DancerMediaBatchSubmission";
import { useDancerProfileVideos } from "./useDancerProfileVideos";
import type { DancerIdentityDraft, LoadState } from "./dashboard-types";
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
  draftIdentity, profile, onProfileChange, onboarding = false, active = true, clubMedia,
  onContinue, continueLabel = "Continue to agreement", onBusyChange, isPublic = false, uploadBusy = false, visibilityContent,
}: {
  identityContent: ReactNode; avatarContent: ReactNode; mainPhotoContent: ReactNode;
  photoContent: ReactNode; videoContent: ReactNode; draftIdentity: DancerIdentityDraft;
  profile?: LoadState["profile"]; onProfileChange?: (profile: Record<string, unknown>) => void;
  clubMedia?: ClubMediaState;
  uploadBusy?: boolean;
  active?: boolean;
  onboarding?: boolean; profileReady?: boolean; agreementComplete?: boolean; onContinue?: () => void; continueLabel?: string;
  onBusyChange?: (busy: boolean) => void; isPublic?: boolean;
  visibilityContent?: ReactNode;
}) {
  const [step, setStep] = useState<ProfileStep>("details");
  useDashboardHelpArea(step === "details" ? "setup-details" : "setup-media", onboarding && active);
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
        window.requestAnimationFrame(() => {
          const target = root.current?.querySelector<HTMLElement>(`#${targetId}`);
          target?.closest<HTMLDetailsElement>("details.dancer-media-identity-controls")?.setAttribute("open", "");
          target?.scrollIntoView({ block: "start" });
        });
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
  const [removedMedia, setRemovedMedia] = useState<{ photos: string[]; videos: string[] }>({ photos: [], videos: [] });
  useEffect(() => { setRemovedMedia({ photos: [], videos: [] }); }, [profile?.id, clubMedia?.selectedClub?.id]);
  useEffect(() => {
    setDancerMediaEditorVenue(onboarding ? null : clubMedia?.selectedClub?.id || null);
    return () => setDancerMediaEditorVenue(null);
  }, [onboarding, clubMedia?.selectedClub?.id]);
  const sourcePhotos = dancerPhotoItemsFromProfile(profile);
  const photos = relabelPhotoItems(sourcePhotos);
  const approvedPhotos = photos.filter(photo => photo.status === "approved").sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
  const libraryPhotos = [...photos, ...rejectedPhotoItemsFromProfile(profile).filter(rejected => !photos.some(photo => photo.id === rejected.id))]
    .filter(photo => !removedMedia.photos.includes(photo.id) && (photo.status === "approved" || photo.status === "rejected" || mediaReviewLabel(photo.status, photo.moderationStatus) === "Awaiting final approval"))
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)));
  const libraryVideos = uploadedVideos.filter(video => !removedMedia.videos.includes(video.id)
    && !["hidden", "removed", "expired"].includes(video.status)).map(video => ({ ...video, imageUrl: video.posterUrl }));
  const editorClubMedia = onboarding && clubMedia?.filterToClub ? { ...clubMedia, filterToClub: false } : clubMedia;
  const clubScoped = Boolean(editorClubMedia?.filterToClub);
  const editorUnavailable = !onboarding && Boolean(clubMedia && (!clubMedia.selectedClub || clubMedia.loading || clubMedia.error));
  const editorPhotos = clubScoped && editorClubMedia ? clubPreviewMedia(libraryPhotos, editorClubMedia) : libraryPhotos;
  const primaryPhoto = approvedPhotos.find(photo => photo.isPrimary);
  const pendingMainPhoto = photos.find(photo => photo.isPrimary && photo.status === "pending" && !removedMedia.photos.includes(photo.id));
  const mainPhoto = clubScoped ? editorPhotos.find(photo => mediaClubStatuses(selectedClubMediaRows(editorClubMedia), photo.id).some(row => row.isMain))
    || editorPhotos.find(photo => photo.isPrimary) || editorPhotos[0] : pendingMainPhoto || primaryPhoto;
  const savedAvatar = dancerAvatarPreview({ ...profile, pending_photo_reviews: [] });
  const avatarPreview = clubScoped ? mainPhoto && mainPhoto.id === primaryPhoto?.id && savedAvatar.avatarUrl ? savedAvatar
    : { avatarUrl: mainPhoto?.imageUrl || "", objectPosition: mainPhoto?.id === primaryPhoto?.id
    ? `${profile?.primaryPhotoFocalX ?? 50}% ${profile?.primaryPhotoFocalY ?? 50}%` : "50% 50%" } : dancerAvatarPreview(profile, pendingMainPhoto?.id);
  const clubRows = selectedClubMediaRows(clubMedia);
  const mainClubRejection = mediaClubRejection(clubRows, mainPhoto?.id);
  const mainAndAvatarAdded = Boolean(libraryPhotos.some(photo => photo.isPrimary && photo.imageUrl)
    && avatarPreview.avatarUrl);
  const mainPhotoSummary = clubScoped && !mainPhoto ? editorClubMedia?.loading ? "Checking club approvals…" : editorClubMedia?.error ? "Club approvals unavailable"
    : editorClubMedia?.selectedClub ? `No approved photo at ${editorClubMedia.selectedClub.name} yet` : "Choose a club to edit its media"
    : (mainPhoto?.status === "approved" ? mediaClubItemLabel(clubMedia, mainPhoto.id) : "") || mainClubRejection || (!mainPhoto ? "Add your main photo"
    : mainPhoto.status === "approved" && !avatarPreview.avatarUrl ? "Main photo approved · Avatar pending"
    : mediaReviewLabel(mainPhoto.status, mainPhoto.moderationStatus));
  const mainNeedsAttention = Boolean(mainClubRejection) || mainPhotoSummary === "Review delayed";
  const pendingReviewIds = new Set((Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).map((review: Record<string, unknown>) => String(review.id)));
  const dirty = draftIdentity.stageName.trim() !== persistedDancerStageName(profile)
    || draftIdentity.city.trim() !== String(profile?.city || "").trim();
  const detailsSaved = Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
  const submittedMedia = dancerSubmissionMedia(profile);
  const galleryReady = submittedMedia.count >= MIN_DANCER_ONBOARDING_PHOTOS;
  const photosReady = submittedMedia.hasMain && galleryReady;
  const videoCount = dancerSubmissionVideoCount(uploadedVideos.filter(video => !removedMedia.videos.includes(video.id)));
  const videosReady = videoCount >= MIN_DANCER_ONBOARDING_VIDEOS && !isMediaLoading && !mediaError;
  const mediaReady = photosReady && videosReady;
  const videoBlocker = isMediaLoading ? "Checking your video uploads…" : mediaError || (!videosReady ? "Add at least 1 video (1–30 seconds) and wait for file processing to finish." : "");
  const photoBlocker = !submittedMedia.hasMain ? "Add your main photo to continue."
    : !galleryReady ? `Add ${MIN_DANCER_ONBOARDING_PHOTOS - submittedMedia.count} more profile photo${MIN_DANCER_ONBOARDING_PHOTOS - submittedMedia.count === 1 ? "" : "s"}. Your automatic avatar doesn’t count as another photo. Pending uploads count.` : "";
  const identityHint = draftIdentity.stageName.trim().length < 2 ? "Enter your stage name."
    : !draftIdentity.city.trim() ? "Choose your city." : "";
  const setupHint = identityHint || (step === "details" ? "" : photoBlocker || videoBlocker);
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
  useEffect(() => { setStatus(""); }, [submittedMedia.count, submittedMedia.hasMain]);
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

  function closeMediaEditor(kind: ProfileUploadKind) {
    if (hasActiveUpload()) return;
    setUploadKind(current => current === kind ? null : current);
  }

  function addMedia(kind: ProfileUploadKind) {
    if (hasActiveUpload() || editorUnavailable) return;
    setUploadKind(kind);
    window.requestAnimationFrame(() => {
      const selector = kind === "photos" ? "#dancer-profile-media-library" : "#dancer-profile-video-library";
      root.current?.querySelector<HTMLButtonElement>(`${selector} button[data-profile-upload]`)?.click();
    });
  }

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
      area?.closest<HTMLDetailsElement>("details.dancer-media-identity-controls")?.setAttribute("open", "");
      area?.scrollIntoView({ behavior: "smooth", block: "start" });
      area?.querySelector<HTMLElement>('input:not([type="file"]), select, button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }
  const needsDetails = dirty || !detailsSaved;
  function advanceSetup() {
    if (savingRef.current) return;
    if (hasActiveUpload()) { setStatus("Wait for your upload to finish, then continue."); return; }
    if (step === "details") { void save("media"); return; }
    if (identityHint) { showStep("details"); setStatus(identityHint); return; }
    if (!photosReady) { revealMissingPhoto(); setStatus(photoBlocker); return; }
    if (!videosReady) { openEditorArea("dancer-profile-video-library"); setStatus(videoBlocker); return; }
    void save("continue");
  }
  function chooseStep(next: ProfileStep) {
    if (savingRef.current || hasActiveUpload() || next === step) return;
    if (next === "details") { showStep(next); return; }
    if (needsDetails) { void save(next); return; }
    showStep(next);
  }
  function revealMissingPhoto() {
    setUploadKind("photos");
    window.requestAnimationFrame(() => {
      const notice = root.current?.querySelector<HTMLElement>("#dancer-builder-photo-requirement");
      notice?.scrollIntoView({ behavior: "smooth", block: "center" });
      notice?.focus({ preventScroll: true });
    });
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
        if (next === "continue" && mediaReady) onContinue?.();
        else showStep("media");
      }
    } catch {
      if (mounted.current) setStatus("Unable to save your changes. Please try again.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function renderLibrary(kind: ProfileUploadKind, uploads: MediaLibraryItem[]) {
    return kind === "photos" ? (
        <DancerProfileMediaUploads key={clubScoped ? clubMedia?.selectedClub?.id : "profile"} clubMedia={editorClubMedia} compact expanded slotEditor onAdd={() => addMedia("photos")} mediaType="photos" photos={mergeMediaLibraryItems(libraryPhotos, uploads, removedMedia.photos)} videos={[]}
          onProfileChange={onProfileChange}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={false} videoError=""
          disabled={busy || editorUnavailable}
          onOpen={() => addMedia("photos")} onDeleteBusyChange={setMediaBusy}
          onPhotoDeleted={id => {
            setRemovedMedia(current => ({ ...current, photos: [...current.photos, id] }));
            if (clubScoped) return;
            onProfileChange?.({ ...profile,
            dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).filter((photo: Record<string, unknown>) => photo.id !== id),
            pending_photo_reviews: (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).filter((photo: Record<string, unknown>) => photo.id !== id),
            rejected_photo_reviews: (Array.isArray(profile?.rejected_photo_reviews) ? profile.rejected_photo_reviews : []).filter((photo: Record<string, unknown>) => photo.id !== id),
          }); }}
          onVideoDeleted={() => {}}
          onMediaPinned={(_kind, id, pinned) => { if (!clubScoped) onProfileChange?.({ ...profile, dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).map((photo: Record<string, unknown>) => photo.id === id ? { ...photo, is_pinned: pinned } : photo) }); }}
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
              <DancerSavedPhotoCrop photo={clubScoped ? { ...photo, isPrimary: mainPhoto?.id === photo.id } : photo} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} />
              {photo.id !== mainPhoto?.id ? <DancerChooseMainPhoto photo={photo} mainPhotoId={mainPhoto?.id} disabled={busy} onProfileChange={onProfileChange} onBusyChange={reportCropBusy} /> : <span className="dancer-main-label">Main photo</span>}
            </> : null;
          }}
        />
    ) : (
        <DancerProfileMediaUploads key={clubScoped ? clubMedia?.selectedClub?.id : "profile"} clubMedia={editorClubMedia} compact expanded slotEditor onAdd={() => addMedia("videos")} mediaType="videos" photos={[]} videos={mergeMediaLibraryItems(libraryVideos, uploads, removedMedia.videos)}
          onProfileChange={onProfileChange}
          isApproved={!onboarding} isPublic={isPublic} isVideoLoading={isMediaLoading} videoError={mediaError}
          disabled={busy || editorUnavailable}
          onOpen={() => addMedia("videos")} onDeleteBusyChange={setMediaBusy}
          onPhotoDeleted={() => {}}
          onVideoDeleted={id => {
            setRemovedMedia(current => ({ ...current, videos: [...current.videos, id] }));
            if (!clubScoped) setUploadedVideos(current => current.filter(video => video.id !== id));
          }}
          onMediaPinned={(_kind, id, pinned) => { if (!clubScoped) setUploadedVideos(current => current.map(video => video.id === id ? { ...video, isPinned: pinned } : video)); }}
        />
    );
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
        {step === "media" ? <span className="dancer-builder-requirement" data-state={mainNeedsAttention ? "attention" : mediaReady ? "saved" : "required"} role="status">{mainNeedsAttention ? "Main photo needs attention" : mediaReady ? "Media ready" : !submittedMedia.hasMain ? "Add main photo" : `${submittedMedia.count}/${MIN_DANCER_ONBOARDING_PHOTOS} photos · ${videoCount}/${MIN_DANCER_ONBOARDING_VIDEOS} video`}</span> : null}
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
    <DancerProfileUploadContext.Provider value={{ active: uploadKind, open: openUpload, libraryEditor: true, busy: busy || editorUnavailable, renderLibrary,
      venueId: onboarding ? null : clubMedia?.selectedClub?.id,
      displayedMedia: { photos: [...libraryPhotos.map(photo => photo.id), ...removedMedia.photos], videos: [...libraryVideos.map(video => video.id), ...removedMedia.videos] } }}>
    <fieldset disabled={saving} className="dancer-workspace-edit">
      <section hidden={onboarding && step !== "details"} className="dancer-workspace-card" id="dancer-details-section" aria-label={onboarding ? "Name and city" : undefined} aria-labelledby={onboarding ? undefined : "dancer-details-title"}>
        {!onboarding ? <header><h3 id="dancer-details-title">Your details</h3></header> : null}
        {identityContent}
      </section>
      <div className="dancer-profile-media-area" hidden={onboarding && step !== "media"}>
      {!onboarding && <DancerMediaClubView state={editorClubMedia} photos={libraryPhotos} videos={libraryVideos} disabled={busy} videoLoading={isMediaLoading} videoError={mediaError} />}
      <DancerMediaReviewOutcome value={profile?.media_review_outcome} disabled={busy} onAction={openEditorArea} />
      {!onboarding && active && !editorUnavailable && <DancerMediaBatchSubmission key={clubMedia?.selectedClub?.id} venueId={clubMedia?.selectedClub?.id} disabled={busy || Object.values(pendingUploads).some(Boolean)}
        hasPendingMedia={photos.some(photo => photo.status === "pending") || Boolean(profile?.pending_avatar_review)
          || uploadedVideos.some(video => ["uploading", "moderating", "submitted"].includes(video.status))}
        checkedIn={Boolean(clubMedia?.activeClub && clubMedia.activeClub.id === clubMedia.selectedClub?.id)}
        refreshKey={JSON.stringify([clubMedia?.selectedClub?.id, profile?.id, profile?.dancer_photos, profile?.pending_photo_reviews, profile?.pending_avatar_review, uploadedVideos])} />}
      <button type="button" className="dancer-main-photo-overview" disabled={busy || editorUnavailable}
        data-needs-attention={mainNeedsAttention || undefined}
        aria-label="Edit main photo and avatar" aria-describedby="dancer-main-photo-overview-status" aria-haspopup="dialog"
        onClick={() => openEditorArea(clubScoped ? "dancer-profile-media-library" : "dancer-main-photo")}>
        <span className="dancer-main-photo-overview-previews" aria-hidden="true">
          <span className="dancer-main-photo-overview-image">{mainPhoto?.imageUrl ? <img src={mainPhoto.imageUrl} alt="" loading="lazy" /> : "+"}</span>
          <span className="dancer-main-photo-overview-avatar">{mainPhoto && avatarPreview.avatarUrl ? <img src={avatarPreview.avatarUrl} alt="" loading="lazy" style={{ objectPosition: avatarPreview.objectPosition }} /> : null}</span>
        </span>
        <span className="dancer-main-photo-overview-copy">
          <strong>Main photo &amp; avatar</strong>
          <span id="dancer-main-photo-overview-status" role="status">{mainPhotoSummary}</span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      <DancerMediaLibrarySection kind="photos" clubMedia={editorClubMedia} items={libraryPhotos} open={active && uploadKind === "photos" && (!onboarding || step === "media")}
        minimumCount={onboarding ? MIN_DANCER_ONBOARDING_PHOTOS : undefined}
        clubContext={!onboarding && <DancerMediaClubView state={editorClubMedia} compact disabled={busy} />}
        attentionIds={libraryPhotos.filter(photo => mediaClubRejection(clubRows, photo.id)).map(photo => photo.id)}
        busy={busy} onOpen={() => openUpload("photos")} onClose={() => closeMediaEditor("photos")}>
      <section className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-media-library" aria-label="Photo uploads and library">
        {onboarding && photoBlocker ? <p id="dancer-builder-photo-requirement" className="dancer-builder-photo-requirement" role="status" tabIndex={-1}>{photoBlocker}</p> : null}
        <details hidden={clubScoped} className="dancer-media-identity-controls" data-needs-attention={mainNeedsAttention || undefined}>
          <summary>Main photo &amp; avatar
            {mainNeedsAttention ? <span className="dancer-media-needs-attention" role="status">Needs attention</span> : mainAndAvatarAdded ? <svg className="dancer-media-identity-complete" role="img" aria-label="Main photo and avatar added" viewBox="0 0 24 24">
              <title>Main photo and avatar added</title><path d="m5 12 4 4L19 6" />
            </svg> : null}
            <svg className="dancer-media-identity-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
        <section className="dancer-workspace-card dancer-profile-photos" id="dancer-required-photos" aria-label="Main photo and automatic avatar">
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
        </section>
        </details>
        <div className="dancer-section-uploader">{photoContent}</div>
      </section>
      </DancerMediaLibrarySection>
      <DancerMediaLibrarySection kind="videos" clubMedia={editorClubMedia} items={libraryVideos} removedIds={removedMedia.videos} open={active && uploadKind === "videos" && (!onboarding || step === "media")}
        minimumCount={onboarding ? MIN_DANCER_ONBOARDING_VIDEOS : undefined}
        clubContext={!onboarding && <DancerMediaClubView state={editorClubMedia} compact disabled={busy} />}
        attentionIds={libraryVideos.filter(video => mediaClubRejection(clubRows, video.id, "video")).map(video => video.id)}
        busy={busy} loading={isMediaLoading} error={mediaError} onOpen={() => openUpload("videos")} onClose={() => closeMediaEditor("videos")}>
      <section className="dancer-workspace-card dancer-workspace-media" id="dancer-profile-video-library" aria-label="Video uploads and library">
        {onboarding && videoBlocker ? <p className="dancer-builder-photo-requirement" role="status">{videoBlocker}</p> : null}
        <div className="dancer-section-uploader dancer-builder-video-uploader" id="dancer-builder-video-upload">{videoContent}</div>
      </section>
      </DancerMediaLibrarySection>
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
