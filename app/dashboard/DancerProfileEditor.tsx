"use client";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { DancerPhotoCarousel } from "@/app/dancers/[slug]/DancerPhotoCarousel";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import { DANCER_PROFILE_VIDEOS_CHANGED_EVENT } from "./dancer-profile-media-sync";
import { readSession, requestDashboardJson, requestDancerProfileJson, requestDancerTvVideosJson } from "./dashboard-session";
import type { DancerProfileBuilderRequirement, DancerProfileEditorSections, LoadState, DancerProfileEditorSectionId, DancerPreviewVideo, DancerPhotoItem, DancerStepOneItemState, DancerIdentityDraft } from "./dashboard-types";
import { persistedDancerStageName, DANCER_PROFILE_EDITOR_SECTION_LABELS, DANCER_PHOTOS_KEEP_OPEN_EVENT, saveDancerProfileEditor, AvatarUploadBusyContext } from "./DashboardShared";
import { relabelPhotoItems, dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
import DancerAgeVerificationGate, { type DancerAgeVerification } from "./DancerAgeVerificationGate";
import DancerProfileAgreementReview, { type DancerProfileAgreementInput } from "./DancerProfileAgreementReview";
import { DANCER_AGREEMENT_VERSION } from "@/src/lib/dancr/dancer-agreement-version";
import DancerIdentityEditor from "./DancerIdentityEditor";
const DancerProfileMediaUploads = dynamic(() => import("./DancerProfileMediaUploads"));


export function DancerProfilePreview({
  builderRequirements,
  buttonClassName,
  buttonLabel,
  editorSections,
  initialEditorSection,
  isApproved = false,
  isPublic = false,
  name,
  city,
  onClose,
  onEditorSave,
  onProfileChange,
  profile,
  saveLabel = "Save profile",
}: {
  builderRequirements?: DancerProfileBuilderRequirement[];
  buttonClassName: string;
  buttonLabel: string;
  editorSections?: DancerProfileEditorSections;
  initialEditorSection?: DancerProfileEditorSectionId;
  isApproved?: boolean;
  isPublic?: boolean;
  name?: string;
  city?: string;
  onClose?: () => void;
  onEditorSave?: () => Promise<boolean>;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  saveLabel?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState<DancerProfileEditorSectionId | null>(null);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [isSectionSaving, setIsSectionSaving] = useState(false);
  const [sectionStatus, setSectionStatus] = useState("");
  const [editorStatus, setEditorStatus] = useState("");
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [uploadedVideos, setUploadedVideos] = useState<DancerPreviewVideo[]>([]);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isPhotoDeleting, setIsPhotoDeleting] = useState(false);
  const photoDeletingRef = useRef(false);
  const reportPhotoDeleteBusy = useCallback((busy: boolean) => {
    photoDeletingRef.current = busy;
    setIsPhotoDeleting(busy);
  }, []);
  const avatarUploadingRef = useRef(false);
  const reportAvatarBusy = useCallback((busy: boolean) => {
    avatarUploadingRef.current = busy;
    setIsAvatarUploading(busy);
  }, []);
  const videos = uploadedVideos.filter((video) => video.status === "approved" && video.videoUrl).map(video => ({ ...video, publishedAt: video.createdAt }));
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const activeEditorSectionRef = useRef<DancerProfileEditorSectionId | null>(null);
  const persistedName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const profilePhotoItems = relabelPhotoItems(dancerPhotoItemsFromProfile(profile));
  const approvedPhotos = profilePhotoItems.filter((photo) => photo.status === "approved");
  const previewImage = avatarUrl || approvedPhotos[0]?.imageUrl || "";
  const previewName = name?.trim() || persistedName || "Your stage name";
  const previewCity = city?.trim() || persistedCity || "Choose your city";
  const photos = approvedPhotos.map((photo) => ({ id: photo.id, imageUrl: photo.imageUrl, isPinned: photo.isPinned, isPrimary: photo.isPrimary, sortOrder: photo.sortOrder }));
  const handleMediaPinned = (mediaType: "photo" | "video", mediaId: string, isPinned: boolean) => {
    if (mediaType === "video") setUploadedVideos((current) => current.map((video) => video.id === mediaId ? { ...video, isPinned } : video).sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    else onProfileChange?.({ ...profile, dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).map((photo: any) => photo.id === mediaId ? { ...photo, is_pinned: isPinned } : photo) });
  };
  const isEditor = Boolean(editorSections);
  const headerImage = isEditor ? avatarUrl : previewImage;
  const completedRequirements = builderRequirements?.filter((requirement) => requirement.complete).length || 0;
  const requirementsComplete = !builderRequirements?.length || completedRequirements === builderRequirements.length;
  const isIdentityEditor = activeEditorSection === "identity" || activeEditorSection === "stageName" || activeEditorSection === "city";
  const closeActiveEditor = useCallback(() => {
    if (avatarUploadingRef.current) return;
    const section = activeEditorSectionRef.current;
    setActiveEditorSection(null);
    setSectionStatus("");
    if (section) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-profile-editor-trigger="${section}"]`)?.focus({ preventScroll: true });
      });
    }
  }, []);
  const activeEditorContent = activeEditorSection
    ? editorSections?.[activeEditorSection]
    : null;
  const activeEditorLabel = activeEditorSection
    ? DANCER_PROFILE_EDITOR_SECTION_LABELS[activeEditorSection]
    : "";
  onCloseRef.current = onClose;
  activeEditorSectionRef.current = activeEditorSection;

  const closePreview = useCallback(() => {
    if (avatarUploadingRef.current || photoDeletingRef.current) return;
    setActiveEditorSection(null);
    setIsOpen(false);
    onCloseRef.current?.();
  }, []);

  function openEditorSection(section: DancerProfileEditorSectionId) {
    if (photoDeletingRef.current) return;
    if (!editorSections?.[section]) return;
    setSectionStatus("");
    setActiveEditorSection(section);
  }

  useEffect(() => {
    if (!isOpen || !activeEditorSection) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("dancer-profile-builder-panel")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeEditorSection, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const scrollY = scrollRef.current;
    const body = document.body;
    const trigger = triggerRef.current;
    const previous = {
      left: body.style.left,
      overflow: body.style.overflow,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (activeEditorSectionRef.current) document.getElementById("dancer-profile-builder-panel")?.focus();
      else closeRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog.dancr-photo-crop[open]")) return;
      if (overlayRef.current?.querySelector("dialog.dancer-media-viewer[open]")) return;
      if (event.key === "Escape") {
        if (activeEditorSectionRef.current) {
          closeActiveEditor();
          return;
        }
        closePreview();
        return;
      }
      if (event.key !== "Tab") return;
      const focusRoot = activeEditorSectionRef.current
        ? document.getElementById("dancer-profile-builder-panel")
        : overlayRef.current;
      const focusable = Array.from(
        focusRoot?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => !element.closest("[hidden]") && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo({ top: scrollY, behavior: "auto" });
      window.requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          trigger?.focus({ preventScroll: true });
        }
      });
    };
  }, [closeActiveEditor, closePreview, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!readSession()?.accessToken) {
      setIsMediaLoading(false);
      setUploadedVideos([]);
      setMediaError("Sign in again to load your saved profile videos.");
      return;
    }

    let cancelled = false;
    let refreshTimer = 0;
    let requestSequence = 0;
    let requestController: AbortController | null = null;
    const loadVideos = async (showLoading = false) => {
      const requestId = ++requestSequence;
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      if (showLoading) setIsMediaLoading(true);
      setMediaError("");
      try {
        const data = await requestDancerTvVideosJson({
          cache: "no-store",
          fallbackMessage: "Unable to load your saved profile videos.",
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted || requestId !== requestSequence) return;
        const savedVideos = Array.isArray(data?.videos) ? data.videos : [];
        setUploadedVideos(savedVideos.flatMap((video: Record<string, unknown>) => {
          const id = String(video?.id || "").trim();
          const videoUrl = String(video?.videoUrl || "").trim();
          const posterUrl = String(video?.posterUrl || "").trim();
          const status = String(video?.status || "").toLowerCase();
          if (!id || status === "hidden" || status === "removed" || status === "expired") return [];
          return [{
            id,
            status,
            videoUrl,
            posterUrl: posterUrl || null,
            isPinned: video.isPinned === true,
            createdAt: String(video.createdAt || ""),
            durationSeconds: Math.max(0, Number(video?.durationSeconds || 0)),
          }];
        }));
        const hasProcessingVideo = savedVideos.some((video: Record<string, unknown>) => {
          const status = String(video?.status || "").toLowerCase();
          return status === "uploading" || status === "moderating";
        });
        const hasReviewVideo = savedVideos.some((video: Record<string, unknown>) => video.status === "submitted");
        window.clearTimeout(refreshTimer);
        if (hasProcessingVideo || hasReviewVideo) {
          refreshTimer = window.setTimeout(() => void loadVideos(), hasProcessingVideo ? 1_800 : 8_000);
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted || requestId !== requestSequence) return;
        setMediaError(error instanceof Error ? error.message : "Unable to load your saved profile videos.");
      } finally {
        if (requestController === controller) requestController = null;
        if (!cancelled && !controller.signal.aborted && requestId === requestSequence) setIsMediaLoading(false);
      }
    };
    const refreshAfterVideoChange = () => {
      window.clearTimeout(refreshTimer);
      void loadVideos();
    };

    setUploadedVideos([]);
    void loadVideos(true);
    window.addEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);

    return () => {
      cancelled = true;
      requestSequence += 1;
      requestController?.abort();
      requestController = null;
      window.clearTimeout(refreshTimer);
      window.removeEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);
    };
  }, [isOpen, profile?.id]);

  useEffect(() => {
    if (!isOpen || !editorSections?.photos) return;
    const keepPhotosOpen = () => setActiveEditorSection("photos");
    window.addEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
    return () => window.removeEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
  }, [editorSections?.photos, isOpen]);

  function openPreview() {
    scrollRef.current = window.scrollY;
    setActiveEditorSection(initialEditorSection || null);
    setEditorStatus("");
    setIsOpen(true);
  }

  async function saveEditor() {
    if (!onEditorSave || isEditorSaving || photoDeletingRef.current) return;
    setIsEditorSaving(true);
    setEditorStatus("Saving your profile...");
    try {
      const saved = await onEditorSave();
      if (!saved) {
        setEditorStatus("A profile section could not be saved. Reopen the section you changed and review its message.");
        return;
      }
      setEditorStatus("Profile saved.");
      closePreview();
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : "Unable to save your profile.");
    } finally {
      setIsEditorSaving(false);
    }
  }

  async function finishActiveEditor() {
    if (!activeEditorSection || isSectionSaving || isAvatarUploading) return;
    if (!isIdentityEditor) {
      closeActiveEditor();
      return;
    }

    setIsSectionSaving(true);
    setSectionStatus("Saving...");
    try {
      const saved = await saveDancerProfileEditor();
      if (!saved) {
        setSectionStatus("Check the fields above and try again.");
        return;
      }
      closeActiveEditor();
    } catch (error) {
      setSectionStatus(error instanceof Error ? error.message : "Unable to save your profile details.");
    } finally {
      setIsSectionSaving(false);
    }
  }

  const mediaUploads = (
    <DancerProfileMediaUploads
      photos={profilePhotoItems}
      videos={uploadedVideos.map((video) => ({ id: video.id, imageUrl: video.posterUrl, status: video.status, videoUrl: video.videoUrl, isPinned: video.isPinned }))}
      onMediaPinned={handleMediaPinned}
      isApproved={isApproved}
      isPublic={isPublic}
      isVideoLoading={isMediaLoading}
      videoError={mediaError}
      onOpen={(section) => {
        if (!isOpen) openPreview();
        openEditorSection(section);
      }}
      onDeleteBusyChange={reportPhotoDeleteBusy}
      onVideoDeleted={(videoId) => setUploadedVideos((current) => current.filter((video) => video.id !== videoId))}
      onPhotoDeleted={(photoId) => onProfileChange?.({
        ...profile,
        dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).filter((photo: any) => photo.id !== photoId),
        pending_photo_reviews: (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).filter((photo: any) => photo.id !== photoId),
      })}
    />
  );

  return (
    <>
      <button className={buttonClassName} data-action-state={editorStatus === "Profile saved." ? "success" : "idle"} disabled={isPhotoDeleting} onClick={openPreview} ref={triggerRef} type="button">
        {editorStatus === "Profile saved." ? "✓ Profile saved" : buttonLabel}
      </button>
      {isOpen ? (
        <div
          aria-label={isEditor ? "Edit dancer profile" : undefined}
          aria-labelledby={isEditor ? undefined : "dancer-profile-preview-heading"}
          aria-modal="true"
          className={`dancer-profile-preview-overlay${isEditor ? " is-editor" : ""}`}
          data-photo-deleting={isPhotoDeleting}
          ref={overlayRef}
          role="dialog"
        >
          <div className={`public-profile-shell dancer-profile-preview-shell${isEditor ? "" : " profile-split-layout"}`}>
            <header className="profile-titlebar">
              {isEditor ? (
                <button
                  aria-label={headerImage ? "Edit avatar" : "Add avatar"}
                  className="dancer-profile-builder-avatar-control"
                  data-profile-editor-trigger="avatar"
                  onClick={() => openEditorSection("avatar")}
                  type="button"
                >
                  <span className={`profile-titlebar-avatar dancer-profile-builder-avatar${headerImage ? " has-photo" : " is-empty"}`}>
                    {headerImage ? <img alt="" src={headerImage} /> : (
                      <svg aria-hidden="true" className="dancer-profile-builder-avatar-camera" viewBox="0 0 24 24">
                        <path d="M4 7h4l2-3h4l2 3h4v13H4z" /><circle cx="12" cy="13" r="3.5" />
                      </svg>
                    )}
                  </span>
                  <small>{headerImage ? "Change avatar" : "Add avatar"}</small>
                </button>
              ) : (
                <span className={`profile-titlebar-avatar${headerImage ? " has-photo" : ""}`}>
                  {headerImage ? <img alt="" src={headerImage} /> : previewName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="profile-titlebar-identity">
                <div>
                  {isEditor ? (
                    <button aria-label={name?.trim() || persistedName ? `Edit stage name: ${name?.trim() || persistedName}` : "Add stage name"} className="dancer-profile-builder-identity" data-profile-editor-trigger="stageName" onClick={() => openEditorSection("stageName")} type="button">
                      <span className="dancer-profile-builder-field-copy"><small>Stage name</small><span className="dancer-profile-builder-name" id="dancer-profile-preview-heading">{name?.trim() || persistedName || "Tap to add"}</span></span>
                      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  ) : <h1 id="dancer-profile-preview-heading">{previewName}</h1>}
                </div>
                <div className="profile-titlebar-context">
                  {isEditor ? (
                    <button aria-label={city?.trim() || persistedCity ? `Edit city: ${city?.trim() || persistedCity}` : "Add city"} className="dancer-profile-builder-city" data-profile-editor-trigger="city" onClick={() => openEditorSection("city")} type="button">
                      <span className="dancer-profile-builder-field-copy"><small>City</small><span>{city?.trim() || persistedCity || "Choose city"}</span></span>
                      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  ) : <span className="profile-titlebar-city">{previewCity}</span>}
                </div>
              </div>
              <button
                aria-label={isEditor ? "Close profile editor" : "Close profile preview"}
                className="public-profile-close"
                disabled={isPhotoDeleting}
                onClick={closePreview}
                ref={closeRef}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
              </button>
            </header>
            {isEditor ? mediaUploads : (
              <DancerPhotoCarousel featured dancerId={typeof profile?.id === "string" ? profile.id : undefined} photos={photos} stageName={previewName} videos={videos} />
            )}
            {!isEditor ? (
              <section className="profile-schedule-section dancer-profile-preview-status" aria-labelledby="dancer-profile-preview-status-heading">
                <div className="profile-section-heading"><div><span className="eyebrow">{isApproved ? "Guest view" : "Private preview"}</span><h2 id="dancer-profile-preview-status-heading">{isApproved ? "Public profile preview" : "Guest profile preview"}</h2></div><span>{approvedPhotos.length} photos · {videos.length} videos</span></div>
                <p>{isMediaLoading ? "Loading your approved profile videos. " : mediaError ? `${mediaError} ` : "Approved photos and videos appear in the media switcher above. "}{isApproved ? isPublic ? "This is how your approved profile appears to guests." : "Your approved profile is currently hidden from guests while you are incognito." : "Your profile stays private until every setup step is complete."}</p>
              </section>
            ) : null}
            {isEditor && activeEditorSection && activeEditorContent ? (
              <div
                className="dancer-profile-editor-modal-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && !isSectionSaving) closeActiveEditor();
                }}
              >
                <section
                  aria-labelledby="dancer-profile-builder-panel-heading"
                  aria-modal="true"
                  className="dancer-profile-builder-panel dancer-profile-editor-modal"
                  data-section={activeEditorSection}
                  id="dancer-profile-builder-panel"
                  role="dialog"
                  tabIndex={-1}
                >
                  <header>
                    <h2 id="dancer-profile-builder-panel-heading">{activeEditorLabel}</h2>
                    <button aria-label={`Close ${activeEditorLabel} editor`} disabled={isSectionSaving || isAvatarUploading} onClick={closeActiveEditor} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                  </header>
                  <div className="dancer-profile-editor-modal-body"><AvatarUploadBusyContext.Provider value={reportAvatarBusy}>{activeEditorContent}</AvatarUploadBusyContext.Provider></div>
                  {(["identity", "stageName", "city", "avatar", "photos", "videos"] as DancerProfileEditorSectionId[]).includes(activeEditorSection) ? (
                    <footer className="dancer-profile-editor-modal-actions">
                      {sectionStatus ? <p role="status" aria-live="polite">{sectionStatus}</p> : <span />}
                      <button disabled={isSectionSaving || isAvatarUploading} onClick={() => void finishActiveEditor()} type="button">
                        {isAvatarUploading ? "Please wait..." : isSectionSaving ? "Saving..." : isIdentityEditor ? "Save" : "Done"}
                      </button>
                    </footer>
                  ) : null}
                </section>
              </div>
            ) : null}
            {isEditor && onEditorSave ? (
              <footer className="dancer-profile-editor-footer">
                <p role="status" aria-live="polite">{editorStatus || (builderRequirements?.length ? `Profile essentials: ${completedRequirements}/${builderRequirements.length} complete` : "Save changes when finished")}</p>
                <button aria-busy={isEditorSaving} disabled={isEditorSaving || isPhotoDeleting || !requirementsComplete} onClick={() => void saveEditor()} type="button">
                  {isPhotoDeleting ? "Deleting photo..." : isEditorSaving ? "Saving..." : saveLabel}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}


export function DancerOnboardingCommand({
  agreementReviewRequired = false,
  effectiveStatus,
  isVenueApproved,
  onProfileChange,
  profile,
  profileMediaContent,
  venueVerificationContent,
}: {
  agreementReviewRequired?: boolean;
  effectiveStatus: string;
  isVenueApproved: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  profileMediaContent: (controls: { continueToAgreement: () => void; profileReady: boolean }) => ReactNode;
  venueVerificationContent: ReactNode;
}) {
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [ageVerification, setAgeVerification] = useState<DancerAgeVerification | null>(null);
  const previouslySubmitted = effectiveStatus === "pending_review" || effectiveStatus === "approved";
  const renewingAgreement = previouslySubmitted && agreementReviewRequired;
  const [reviewAgreement, setReviewAgreement] = useState(renewingAgreement);
  const mountedRef = useRef(false);
  const profileSubmissionSequenceRef = useRef(0);
  const profileSubmissionAbortRef = useRef<AbortController | null>(null);
  const profileSubmissionInFlightRef = useRef(false);
  const persistedStageName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const photos = dancerPhotoItemsFromProfile(profile);
  const approvedPhotos = photos.filter((photo) => photo.status === "approved");
  const pendingPhotos = photos.filter((photo) => photo.status === "pending");
  const rejectedPhotos = photos.filter((photo) => photo.status === "rejected");
  const profileStarted = Boolean(
    persistedStageName
    || persistedCity
    || avatarUrl
    || Object.keys(pendingAvatar || {}).length
    || photos.length,
  );
  const profileReady = Boolean(
    persistedStageName
    && persistedCity
    && avatarUrl
    && approvedPhotos.length,
  );
  const submitted = previouslySubmitted && !agreementReviewRequired;
  const ageVerified = ageVerification?.status === "verified";
  const ageNotRequired = !ageVerified && ageVerification?.required === false;
  const ageAccessAllowed = ageVerified || ageNotRequired;
  const setupDetail = profileReady
    ? "Your details, face photo, and main photo are ready. Other media can finish review separately."
    : dancerProfileSetupBlocker({ persistedStageName, persistedCity, avatarUrl, pendingAvatar, approvedPhotos, pendingPhotos, rejectedPhotos });
  const steps = useMemo(() => [
    {
      id: "dancer-profile-media",
      label: "Create profile",
      complete: submitted,
      detail: renewingAgreement ? "Review the updated Dancer Agreement." : submitted ? "Profile submitted. Continue with verification." : profileReady ? "Profile ready. Continue to the next step." : setupDetail,
      locked: false,
    },
    {
      id: "dancer-onboarding-age",
      label: "Verify 18+",
      complete: ageVerified,
      notRequired: ageNotRequired,
      detail: ageVerified ? "Your age is verified. You're ready for your first club tap."
        : ageNotRequired ? "Not required for your account. No age check has been completed."
        : !submitted ? "Unlocks after profile submission."
        : "Verify with Ondato before your first club tap.",
      locked: !submitted,
    },
    {
      id: "dancer-onboarding-nfc",
      label: "Confirm club",
      complete: isVenueApproved,
      detail: isVenueApproved ? "Club confirmed." : submitted && ageAccessAllowed ? "Tap the club’s NFC tag when you arrive." : "Unlocks after profile setup and age verification.",
      locked: !submitted || !ageAccessAllowed,
    },
  ], [ageAccessAllowed, ageNotRequired, ageVerified, isVenueApproved, profileReady, renewingAgreement, setupDetail, submitted]);
  const firstIncomplete = steps.find((step) => !step.complete && !step.notRequired) || steps[steps.length - 1];
  const progressLabel = `${steps.filter((step) => step.complete).length} of ${steps.length} complete${ageNotRequired ? " · 1 not required" : ""}`;
  const visibleExpandedStepId = expandedStepId === null ? firstIncomplete.id : expandedStepId;
  const previousCurrentStep = useRef(firstIncomplete.id);
  useEffect(() => {
    if (previousCurrentStep.current !== firstIncomplete.id) {
      previousCurrentStep.current = firstIncomplete.id;
      setExpandedStepId(firstIncomplete.id);
    }
  }, [firstIncomplete.id]);
  const storageKey = `mydancr:dancer-onboarding-step:${String(profile?.id || "profile")}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      profileSubmissionSequenceRef.current += 1;
      profileSubmissionAbortRef.current?.abort();
      profileSubmissionAbortRef.current = null;
      profileSubmissionInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    window.localStorage.removeItem(storageKey);
    if (renewingAgreement) {
      setReviewAgreement(true);
      setExpandedStepId("dancer-profile-media");
    } else if (new URLSearchParams(window.location.search).get("age-verification") === "returned") {
      setExpandedStepId("dancer-onboarding-age");
    }
  }, [profile?.id, renewingAgreement, storageKey]);

  useEffect(() => {
    const keepPhotosOpen = () => {
      window.localStorage.setItem(storageKey, "dancer-profile-media");
      setExpandedStepId("dancer-profile-media");
    };
    window.addEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
    return () => window.removeEventListener(DANCER_PHOTOS_KEEP_OPEN_EVENT, keepPhotosOpen);
  }, [storageKey]);

  function openStep(id: string) {
    const step = steps.find((candidate) => candidate.id === id);
    if (!step || step.locked) return;
    window.localStorage.setItem(storageKey, id);
    setExpandedStepId(id);
    window.requestAnimationFrame(() => {
      const section = document.getElementById(id);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById(`${id}-button`)?.focus({ preventScroll: true });
    });
  }

  function toggleStep(id: string) {
    const step = steps.find((candidate) => candidate.id === id);
    if (!step || step.locked) return;
    if (visibleExpandedStepId === id) {
      setExpandedStepId("");
      window.localStorage.removeItem(storageKey);
      return;
    }
    openStep(id);
  }

  function continueToProfileAgreement() {
    setReviewAgreement(true);
    setExpandedStepId("dancer-profile-media");
    window.localStorage.setItem(storageKey, "dancer-profile-media");
    window.requestAnimationFrame(() => {
      document.getElementById("dancer-onboarding-agreement")?.scrollIntoView({ behavior: "smooth", block: "start" });
      const nextAction = document.querySelector<HTMLElement>('#dancer-onboarding-agreement input[type="checkbox"]:not(:disabled), #dancer-onboarding-agreement button[type="submit"]:not(:disabled)')
        || document.getElementById("dancer-onboarding-agreement");
      nextAction?.focus({ preventScroll: true });
    });
  }

  function beginProfileSubmissionAction() {
    if (!mountedRef.current || profileSubmissionInFlightRef.current) return null;
    profileSubmissionInFlightRef.current = true;
    const requestId = ++profileSubmissionSequenceRef.current;
    profileSubmissionAbortRef.current?.abort();
    const controller = new AbortController();
    profileSubmissionAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentProfileSubmissionAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === profileSubmissionSequenceRef.current;
  }

  function finishProfileSubmissionAction(requestId: number) {
    if (requestId !== profileSubmissionSequenceRef.current) return false;
    profileSubmissionAbortRef.current = null;
    profileSubmissionInFlightRef.current = false;
    return mountedRef.current;
  }

  async function submitProfile(agreement: DancerProfileAgreementInput) {
    if (!profileReady && !renewingAgreement) return;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in again before submitting your profile.");
      return;
    }
    const action = beginProfileSubmissionAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsSubmitting(true);
    setStatus(renewingAgreement ? "Saving your agreement…" : "Submitting your profile…");
    try {
      if (renewingAgreement) {
        const data = await requestDashboardJson("/api/dancer/agreement", {
          method: "POST", expectedRole: "dancer", timeoutMs: 15000,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(agreement), signal: controller.signal,
        });
        if (!isCurrentProfileSubmissionAction(requestId, controller)) return;
        if (data.agreement?.accepted !== true || data.agreement.version !== DANCER_AGREEMENT_VERSION) {
          throw new Error("Your agreement acceptance was not confirmed. Please try again.");
        }
        setStatus("Agreement saved.");
        window.dispatchEvent(new Event("mydancr:dancer-agreement-saved"));
        return;
      }
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submitForReview: true, ...agreement }),
        fallbackMessage: "Unable to submit profile.",
        signal: controller.signal,
      });
      if (!isCurrentProfileSubmissionAction(requestId, controller)) return;
      if (!data.profile) throw new Error("Unable to submit profile.");
      const confirmedStatus = effectiveDancerProfileStatus(data.profile);
      if (confirmedStatus !== "pending_review" && confirmedStatus !== "approved") {
        throw new Error("Your profile submission was not confirmed. Please try again.");
      }
      onProfileChange?.(data.profile);
      window.dispatchEvent(new Event("mydancr:dancer-agreement-saved"));
      const nextStep = ageAccessAllowed ? "dancer-onboarding-nfc" : "dancer-onboarding-age";
      window.localStorage.setItem(storageKey, nextStep);
      setExpandedStepId(nextStep);
      setStatus(ageAccessAllowed ? "Profile submitted. You're ready for your first club tap." : "Profile submitted. Verify you are 18 or older, then tap the club's official dressing-room sticker to activate your profile.");
      offerPushNotifications("dancer-review");
      window.requestAnimationFrame(() => {
        if (!isCurrentProfileSubmissionAction(requestId, controller)) return;
        document.getElementById(nextStep)?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById(`${nextStep}-button`)?.focus({ preventScroll: true });
      });
    } catch (error) {
      if (isCurrentProfileSubmissionAction(requestId, controller)) {
        setStatus(error instanceof Error ? error.message : "Unable to submit profile.");
      }
    } finally {
      if (finishProfileSubmissionAction(requestId)) setIsSubmitting(false);
    }
  }

  return (
    <section className="dancer-onboarding-command" aria-labelledby="dancer-onboarding-heading">
      <div className="dancer-onboarding-command-head">
        <span>
          <span className="eyebrow">Step {steps.indexOf(firstIncomplete) + 1} of 3</span>
          <h2 id="dancer-onboarding-heading">{renewingAgreement ? "Dancer Agreement" : firstIncomplete.id === "dancer-profile-media" ? "Create your profile" : firstIncomplete.id === "dancer-onboarding-age" ? "Verify you’re 18+" : "Confirm your club"}</h2>
          <p>{renewingAgreement ? "Your saved profile and verification stay in place." : "Three steps to get your profile ready."}</p>
        </span>
        <div className="dancer-onboarding-progress">
          <div className="dancer-onboarding-progress-track" role="progressbar" aria-label="Profile setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((step) => step.complete).length} aria-valuetext={progressLabel}>
            {steps.map((step) => <span className={step.complete ? "is-complete" : step.notRequired ? "is-not-required" : step.id === firstIncomplete.id ? "is-current" : ""} key={step.id}>{step.complete ? "✓" : step.notRequired ? "–" : ""}</span>)}
          </div>
          <b>{progressLabel}</b>
        </div>
      </div>
      <ol className="dancer-onboarding-steps" aria-label="Dancer profile approval progress">
        {steps.map((step, index) => {
          const open = visibleExpandedStepId === step.id;
          const displayComplete = step.complete;
          const controlLabel = step.locked
            ? "Locked"
            : displayComplete
              ? "Complete"
              : step.notRequired
                ? "Not required"
                : step.id === "dancer-profile-media"
                  ? profileStarted ? "Continue" : "Start"
                  : "Verify";
          const controlTone = step.locked ? "locked" : displayComplete ? "complete" : step.notRequired ? "optional" : "action";
          const panelId = `${step.id}-panel`;
          return (
            <li
              className={`${displayComplete ? "is-complete" : step.id === firstIncomplete.id ? "is-current" : ""} ${open ? "is-open" : ""} ${step.locked ? "is-locked" : ""}`.trim()}
              id={step.id}
              key={step.id}
            >
              <button
                aria-label={`${step.label}. ${step.detail} ${controlLabel}.`}
                aria-controls={panelId}
                aria-current={step.id === firstIncomplete.id ? "step" : undefined}
                aria-disabled={step.locked}
                aria-expanded={open}
                disabled={step.locked}
                id={`${step.id}-button`}
                onClick={() => toggleStep(step.id)}
                type="button"
              >
                <span className="dancer-onboarding-step-marker" aria-hidden="true">{displayComplete ? "✓" : index + 1}</span>
                <span className="dancer-onboarding-step-copy">
                  <span className="dancer-onboarding-step-title">
                    <strong>{step.label}</strong>
                  </span>
                  <small>{step.detail}</small>
                </span>
                <span className={`dancer-onboarding-step-control is-${controlTone}`} aria-hidden="true">
                  {controlTone === "locked" ? (
                    <svg className="dancer-onboarding-step-control-icon" viewBox="0 0 24 24">
                      <rect x="5" y="10" width="14" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  ) : (
                    <>
                      {controlTone === "complete" ? <span className="dancer-onboarding-step-check">✓</span> : null}
                      <span>{controlLabel}</span>
                      <svg className={`dancer-onboarding-step-control-chevron ${open ? "is-open" : ""}`} viewBox="0 0 24 24">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </>
                  )}
                </span>
              </button>
              <div
                aria-labelledby={`${step.id}-button`}
                className="dancer-onboarding-step-panel"
                hidden={!open}
                id={panelId}
                role="region"
              >
                {step.id === "dancer-profile-media" ? (
                  <>
                    <div hidden={reviewAgreement && (profileReady || renewingAgreement) && !submitted}>{profileMediaContent({
                      continueToAgreement: continueToProfileAgreement,
                      profileReady,
                    })}</div>
                    <div hidden={!reviewAgreement && !submitted} className="dancer-onboarding-agreement" id="dancer-onboarding-agreement" tabIndex={-1}>
                      {reviewAgreement && !submitted && !renewingAgreement ? <button type="button" disabled={isSubmitting} onClick={() => setReviewAgreement(false)}>← Back to profile</button> : null}
                      {submitted ? (
                        <div className="dancer-onboarding-complete-note" role="status">
                          <strong>✓ Profile complete</strong>
                          <span>Your saved photos remain editable. Complete verification and confirm your club to activate your profile.</span>
                        </div>
                      ) : profileReady || renewingAgreement ? (
                        <DancerProfileAgreementReview key={String(profile?.id)} profileId={String(profile?.id)} busy={isSubmitting} onSubmit={submitProfile} />
                      ) : null}
                      <p className="dancer-onboarding-announcement" id="dancer-onboarding-agreement-status" role="status" aria-live="polite">
                        {status || (!profileReady && !submitted && !renewingAgreement ? setupDetail : "")}
                      </p>
                    </div>
                  </>
                ) : null}
                {step.id === "dancer-onboarding-age" ? (
                  <DancerAgeVerificationGate profileSubmitted={submitted} onVerificationChange={setAgeVerification}>
                    {submitted && ageAccessAllowed ? <div className="dancer-onboarding-complete-note" role="status">
                      <strong>Ready to confirm your club</strong>
                      <span>Tap the club’s NFC tag when you arrive.</span>
                      <button className="dancer-onboarding-primary" type="button" onClick={() => openStep("dancer-onboarding-nfc")}>Continue</button>
                    </div> : null}
                  </DancerAgeVerificationGate>
                ) : null}
                {step.id === "dancer-onboarding-nfc" && submitted && ageAccessAllowed ? venueVerificationContent : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}


function dancerProfileSetupBlocker({
  persistedStageName,
  persistedCity,
  avatarUrl,
  pendingAvatar,
  approvedPhotos,
  pendingPhotos,
  rejectedPhotos,
}: {
  persistedStageName: string;
  persistedCity: string;
  avatarUrl: string;
  pendingAvatar?: Record<string, unknown>;
  approvedPhotos: DancerPhotoItem[];
  pendingPhotos: DancerPhotoItem[];
  rejectedPhotos: DancerPhotoItem[];
}) {
  if (!persistedStageName || !persistedCity) return "Save your stage name and city.";
  if (pendingAvatar) return "Your face photo is being reviewed.";
  if (!avatarUrl) return "Add a clear face photo.";
  if (pendingPhotos.length) return `${pendingPhotos.length} profile ${pendingPhotos.length === 1 ? "picture is" : "pictures are"} still being moderated.`;
  if (rejectedPhotos.length) return "Replace the profile picture that did not pass moderation.";
  if (!approvedPhotos.length) return "Upload at least one profile picture that passes moderation.";
  return "Save the remaining profile changes.";
}


function persistedStageNameAndCity(profile?: LoadState["profile"]) {
  return Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
}


export function DancerOnboardingProfileMediaWorkspace({
  avatarContent,
  draftIdentity,
  identityContent,
  photoContent,
  mainPhotoContent,
  profile,
  profileReady,
  videoContent,
}: {
  avatarContent: ReactNode;
  draftIdentity: DancerIdentityDraft;
  identityContent: (field?: keyof DancerIdentityDraft) => ReactNode;
  photoContent: ReactNode;
  mainPhotoContent?: ReactNode;
  profile?: LoadState["profile"];
  profileReady: boolean;
  videoContent: ReactNode;
}) {
  const persistedStageName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const draftChanged = draftIdentity.stageName.trim() !== persistedStageName
    || draftIdentity.city.trim() !== persistedCity;
  const avatarState: DancerStepOneItemState = pendingAvatar
    ? "checking"
    : avatarUrl
      ? "complete"
      : "missing";
  const [videosOpened, setVideosOpened] = useState(false);
  const [hasStoredDraft, setHasStoredDraft] = useState<boolean | null>(null);
  const refreshDraftStatus = useCallback(() => {
    try {
      const profileId = String(profile?.id || "profile");
      setHasStoredDraft(Boolean(
        window.localStorage.getItem(`mydancr:dancer-profile-draft:${profileId}`),
      ));
    } catch {
      setHasStoredDraft(false);
    }
  }, [profile?.id]);
  useEffect(() => {
    refreshDraftStatus();
  }, [draftIdentity, profile, refreshDraftStatus]);
  const hasUnsavedChanges = draftChanged || hasStoredDraft === true;
  const profileIsSaved = Boolean(persistedStageName && persistedCity) && hasStoredDraft === false && !hasUnsavedChanges;

  return (
    <div className="dancer-onboarding-profile-workspace">
      <article className="dancer-profile-editor-launch-card" data-ready={profileReady} aria-labelledby="dancer-profile-setup-launch-heading">
        <span>
          <span className="dancer-profile-setup-heading">
            <strong id="dancer-profile-setup-launch-heading">Profile details</strong>
            <span className={`dancer-profile-save-indicator${hasUnsavedChanges ? " is-unsaved" : ""}`} role="status" aria-live="polite" aria-atomic="true">
              {hasUnsavedChanges ? "Unsaved changes" : profileIsSaved ? <><span aria-hidden="true">✓</span> Profile saved</> : null}
            </span>
          </span>
          <small>{persistedStageName && persistedCity ? `${persistedStageName} · ${persistedCity}` : "Add your stage name and city."}</small>
        </span>
        <DancerIdentityEditor key={String(profile?.id || "profile")} onClose={refreshDraftStatus}>
          {identityContent()}
        </DancerIdentityEditor>
      </article>
      <details className="dancer-setup-extra" open={avatarState !== "complete" ? true : undefined}>
        <summary>Avatar <small>{avatarState === "complete" ? "✓ Saved" : "Required"}</small></summary>
        {avatarContent}
      </details>
      {mainPhotoContent}
      <details className="dancer-setup-extra">
        <summary>More photos <small>Optional</small></summary>
        {photoContent}
      </details>
      <details className="dancer-setup-extra" onToggle={event => { if (event.currentTarget.open) setVideosOpened(true); }}>
        <summary>Videos <small>Optional · Add later</small></summary>
        {videosOpened ? videoContent : null}
        <button type="button" className="dancer-setup-skip" onClick={event => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>Skip for now</button>
      </details>
    </div>
  );
}
