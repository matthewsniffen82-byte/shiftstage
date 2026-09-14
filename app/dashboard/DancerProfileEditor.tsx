"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { DancerPhotoCarousel } from "@/app/dancers/[slug]/DancerPhotoCarousel";
import { SocialLinks, SocialPlatformIcon } from "@/app/dancers/[slug]/SocialLinks";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { DANCER_PROFILE_VIDEOS_CHANGED_EVENT } from "./dancer-profile-media-sync";
import { readSession, requestDancerFinanceJson, requestDancerProfileJson, requestDancerTvVideosJson } from "./dashboard-session";
import type { DancerProfileBuilderRequirement, DancerProfileEditorSections, LoadState, DancerProfileEditorSectionId, DancerPreviewVideo, DancerPhotoItem, DancerStepOneItemState, DancerIdentityDraft, DancerProfileSocialEditor } from "./dashboard-types";
import { persistedDancerStageName, DANCER_PROFILE_EDITOR_SECTION_LABELS, DANCER_PHOTOS_KEEP_OPEN_EVENT, saveDancerProfileEditor, SOCIAL_PLATFORMS, AvatarUploadBusyContext, DANCER_PREVIEW_SOCIAL_PLATFORMS } from "./DashboardShared";
import { relabelPhotoItems, dancerPhotoItemsFromProfile } from "./DancerPhotoPanel";
const DancerProfileMediaUploads = dynamic(() => import("./DancerProfileMediaUploads"));


export function DancerProfilePreview({
  builderRequirements,
  buttonClassName,
  buttonLabel,
  editorSections,
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
  const [activeSocialPlatform, setActiveSocialPlatform] = useState<SocialPlatform | null>(null);
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
  const socialLinks = dancerPreviewSocialLinks(profile);
  const isEditor = Boolean(editorSections);
  const headerImage = isEditor ? avatarUrl : previewImage;
  const completedRequirements = builderRequirements?.filter((requirement) => requirement.complete).length || 0;
  const requirementsComplete = !builderRequirements?.length || completedRequirements === builderRequirements.length;
  const closeActiveEditor = useCallback(() => {
    if (avatarUploadingRef.current) return;
    const platform = activeSocialPlatform;
    const section = activeEditorSectionRef.current;
    setActiveEditorSection(null);
    setActiveSocialPlatform(null);
    setSectionStatus("");
    if (platform) {
      window.requestAnimationFrame(() => {
        document.getElementById(`dancer-social-trigger-${platform}`)?.focus({ preventScroll: true });
      });
    } else if (section) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-profile-editor-trigger="${section}"]`)?.focus({ preventScroll: true });
      });
    }
  }, [activeSocialPlatform]);
  const activeEditorContent = activeEditorSection && activeEditorSection !== "socials"
    ? editorSections?.[activeEditorSection]
    : null;
  const socialEditorContent = activeSocialPlatform
    ? editorSections?.socials?.(activeSocialPlatform, { onClose: closeActiveEditor })
    : null;
  const activeEditorLabel = activeEditorSection && activeEditorSection !== "socials"
    ? DANCER_PROFILE_EDITOR_SECTION_LABELS[activeEditorSection]
    : "";
  onCloseRef.current = onClose;
  activeEditorSectionRef.current = activeEditorSection;

  const closePreview = useCallback(() => {
    if (avatarUploadingRef.current || photoDeletingRef.current) return;
    setActiveEditorSection(null);
    setActiveSocialPlatform(null);
    setIsOpen(false);
    onCloseRef.current?.();
  }, []);

  function openEditorSection(section: Exclude<DancerProfileEditorSectionId, "socials">) {
    if (photoDeletingRef.current) return;
    if (!editorSections?.[section]) return;
    setSectionStatus("");
    setActiveSocialPlatform(null);
    setActiveEditorSection(section);
  }

  function openSocialEditor(platform: SocialPlatform) {
    if (!editorSections?.socials) return;
    setActiveSocialPlatform(platform);
    setActiveEditorSection("socials");
  }

  useEffect(() => {
    if (!isOpen || !activeEditorSection) return;
    const frame = window.requestAnimationFrame(() => {
      if (activeEditorSection === "socials" && activeSocialPlatform) {
        document.getElementById(`dancer-social-${activeSocialPlatform}`)?.focus({ preventScroll: true });
        return;
      }
      document.getElementById("dancer-profile-builder-panel")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeEditorSection, activeSocialPlatform, isOpen]);

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
      if (overlayRef.current?.querySelector("dialog.dancer-media-viewer[open]")) return;
      if (event.key === "Escape") {
        if (activeEditorSectionRef.current === "socials") {
          document.querySelector<HTMLButtonElement>("[data-social-modal-close]")?.click();
          return;
        }
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
      window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
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
    setActiveEditorSection(null);
    setActiveSocialPlatform(null);
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
    if (activeEditorSection !== "identity") {
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
      onPhotoDeleted={(photoId, refreshedProfile) => onProfileChange?.(refreshedProfile || {
        ...profile,
        dancer_photos: (Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : []).filter((photo: any) => photo.id !== photoId),
        pending_photo_reviews: (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : []).filter((photo: any) => photo.id !== photoId),
      })}
    />
  );

  return (
    <>
      <button className={buttonClassName} disabled={isPhotoDeleting} onClick={openPreview} ref={triggerRef} type="button">
        {buttonLabel}
      </button>
      {isOpen ? (
        <div
          aria-label={isEditor ? "Edit dancer profile" : undefined}
          aria-labelledby={isEditor ? undefined : "dancer-profile-preview-heading"}
          aria-modal="true"
          className={`dancer-profile-preview-overlay${isEditor ? " is-editor" : ""}`}
          ref={overlayRef}
          role="dialog"
        >
          <div className="public-profile-shell dancer-profile-preview-shell">
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
                    <button aria-label={name?.trim() || persistedName ? `Edit stage name: ${name?.trim() || persistedName}` : "Add stage name"} className="dancer-profile-builder-identity" data-profile-editor-trigger="identity" onClick={() => openEditorSection("identity")} type="button">
                      <span className="dancer-profile-builder-field-copy"><small>Stage name</small><span className="dancer-profile-builder-name" id="dancer-profile-preview-heading">{name?.trim() || persistedName || "Tap to add"}</span></span>
                      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                  ) : <h1 id="dancer-profile-preview-heading">{previewName}</h1>}
                </div>
                <div className="profile-titlebar-context">
                  {isEditor ? (
                    <button aria-label={city?.trim() || persistedCity ? `Edit city: ${city?.trim() || persistedCity}` : "Add city"} className="dancer-profile-builder-city" data-profile-editor-trigger="identity" onClick={() => openEditorSection("identity")} type="button">
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
              <DancerPhotoCarousel dancerId={typeof profile?.id === "string" ? profile.id : undefined} photos={photos} stageName={previewName} videos={videos} />
            )}
            {isEditor ? (
              <section className="profile-social-section dancer-profile-builder-socials" aria-labelledby="dancer-profile-builder-social-heading">
                <div className="social-links-control">
                  <div className="social-list-heading">
                    <h2 id="dancer-profile-builder-social-heading">Social Links</h2>
                    <p>Optional. Add whichever profiles you want, or skip this for now.</p>
                  </div>
                  <div className="social-list dancer-profile-builder-social-platforms" aria-label="Add social links">
                    {SOCIAL_PLATFORMS.map((platform) => {
                      const hasLink = socialLinks.some((link) => link.platform === platform.key);
                      return (
                        <button
                          aria-label={`${hasLink ? "Edit" : "Add"} ${platform.label}`}
                          className={`social-link social-link-${platform.key} dancer-profile-builder-social-platform${hasLink ? " is-added" : ""}`}
                          id={`dancer-social-trigger-${platform.key}`}
                          key={platform.key}
                          onClick={() => openSocialEditor(platform.key)}
                          title={`${hasLink ? "Edit" : "Add"} ${platform.label}`}
                          type="button"
                        >
                          <SocialPlatformIcon platform={platform.key} />
                          <span aria-hidden="true">{hasLink ? "✓" : "+"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : socialLinks.length ? (
              <section className="profile-social-section" aria-labelledby="profile-social-heading">
                <SocialLinks dancerId={String(profile?.id || "private-preview")} heading="Socials" links={socialLinks} showConnectLabel={false} trackClicks={false} />
              </section>
            ) : null}
            {!isEditor ? (
              <section className="profile-schedule-section dancer-profile-preview-status" aria-labelledby="dancer-profile-preview-status-heading">
                <div className="profile-section-heading"><div><span className="eyebrow">{isApproved ? "Guest view" : "Private preview"}</span><h2 id="dancer-profile-preview-status-heading">{isApproved ? "Public profile preview" : "Guest profile preview"}</h2></div><span>{approvedPhotos.length} photos · {videos.length} videos</span></div>
                <p>{isMediaLoading ? "Loading your approved profile videos. " : mediaError ? `${mediaError} ` : "Approved photos and videos appear in the media switcher above. "}{socialLinks.length ? `${socialLinks.length} saved social ${socialLinks.length === 1 ? "link is" : "links are"} included in this preview. ` : "Saved social links will appear here. "}{isApproved ? isPublic ? "This is how your approved profile appears to guests." : "Your approved profile is currently hidden from guests while you are incognito." : "Your profile stays private until every setup step is complete."}</p>
              </section>
            ) : null}
            {isEditor && activeEditorSection === "socials" && socialEditorContent ? socialEditorContent : null}
            {isEditor && activeEditorSection && activeEditorSection !== "socials" && activeEditorContent ? (
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
                  {(["identity", "avatar", "photos", "videos"] as DancerProfileEditorSectionId[]).includes(activeEditorSection) ? (
                    <footer className="dancer-profile-editor-modal-actions">
                      {sectionStatus ? <p role="status" aria-live="polite">{sectionStatus}</p> : <span />}
                      <button disabled={isSectionSaving || isAvatarUploading} onClick={() => void finishActiveEditor()} type="button">
                        {isAvatarUploading ? "Please wait..." : isSectionSaving ? "Saving..." : activeEditorSection === "identity" ? "Save" : "Done"}
                      </button>
                    </footer>
                  ) : null}
                </section>
              </div>
            ) : null}
            {isEditor && onEditorSave ? (
              <footer className="dancer-profile-editor-footer">
                <p role="status" aria-live="polite">{editorStatus || (builderRequirements?.length ? `Profile essentials: ${completedRequirements}/${builderRequirements.length} complete` : "Save changes when finished")}</p>
                <button disabled={isEditorSaving || isPhotoDeleting || !requirementsComplete} onClick={() => void saveEditor()} type="button">
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
  effectiveStatus,
  finance,
  isVenueApproved,
  onProfileChange,
  profile,
  profileMediaContent,
  venueVerificationContent,
}: {
  effectiveStatus: string;
  finance?: LoadState["finance"];
  isVenueApproved: boolean;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  profileMediaContent: (controls: { continueToReview: () => void; profileReady: boolean }) => ReactNode;
  venueVerificationContent: ReactNode;
}) {
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPayoutWorking, setIsPayoutWorking] = useState(false);
  const [payoutSkipped, setPayoutSkipped] = useState(false);
  const [payoutStatus, setPayoutStatus] = useState("");
  const [natsLoginId, setNatsLoginId] = useState("");
  const [natsUsername, setNatsUsername] = useState("");
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const profileSubmissionSequenceRef = useRef(0);
  const profileSubmissionAbortRef = useRef<AbortController | null>(null);
  const profileSubmissionInFlightRef = useRef(false);
  const payoutLinkSequenceRef = useRef(0);
  const payoutLinkAbortRef = useRef<AbortController | null>(null);
  const payoutLinkInFlightRef = useRef(false);
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
  const submitted = effectiveStatus === "pending_review" || effectiveStatus === "approved";
  const commissionPlatform = (finance?.commissionPlatform || {}) as Record<string, unknown>;
  const natsAffiliateAccount = (finance?.natsAffiliateAccount || null) as Record<string, unknown> | null;
  const natsSelected = commissionPlatform.selected === true;
  const natsConfigured = commissionPlatform.configured === true;
  const natsPortalUrl = typeof commissionPlatform.affiliatePortalUrl === "string" ? commissionPlatform.affiliatePortalUrl : "";
  const natsAccountStatus = String(natsAffiliateAccount?.status || "");
  const payoutSubmitted = natsAccountStatus === "requested" || natsAccountStatus === "active";
  const payoutStepComplete = payoutSubmitted || payoutSkipped;
  const payoutSkipKey = `mydancr:dancer-payout-setup-later:${String(profile?.id || "profile")}`;
  const setupDetail = profileReady
    ? "Identity, avatar, and at least one profile picture are approved. Other media can finish review separately."
    : dancerProfileSetupBlocker({ persistedStageName, persistedCity, avatarUrl, pendingAvatar, approvedPhotos, pendingPhotos, rejectedPhotos });
  const steps = useMemo(() => [
    {
      id: "dancer-profile-media",
      label: "Create profile",
      complete: submitted,
      detail: submitted ? "Profile submitted for club verification." : profileReady ? "Ready to submit for club verification." : setupDetail,
      locked: false,
    },
    {
      id: "dancer-onboarding-payouts",
      label: "Commission payouts",
      complete: payoutStepComplete,
      detail: natsAccountStatus === "active"
        ? "Your payout account is connected."
        : natsAccountStatus === "requested"
          ? "Payout account verification is pending."
          : payoutSkipped
            ? "Set up later from Earnings."
            : submitted
              ? "Connect your payout account now or set it up later."
              : "Available after you submit your profile.",
      locked: !submitted,
      optional: true,
    },
    {
      id: "dancer-onboarding-nfc",
      label: "Dressing-room tap",
      complete: isVenueApproved,
      detail: isVenueApproved ? "Your venue is verified." : submitted ? "At the club, tap its official dressing-room sticker." : "Unlocks after profile submission.",
      locked: !submitted && !isVenueApproved,
    },
  ], [isVenueApproved, natsAccountStatus, payoutSkipped, payoutStepComplete, profileReady, setupDetail, submitted]);
  const firstIncomplete = steps.find((step) => !step.complete) || steps[steps.length - 1];
  const visibleExpandedStepId = expandedStepId || "";
  const storageKey = `mydancr:dancer-onboarding-step:${String(profile?.id || "profile")}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      profileSubmissionSequenceRef.current += 1;
      profileSubmissionAbortRef.current?.abort();
      profileSubmissionAbortRef.current = null;
      profileSubmissionInFlightRef.current = false;
      payoutLinkSequenceRef.current += 1;
      payoutLinkAbortRef.current?.abort();
      payoutLinkAbortRef.current = null;
      payoutLinkInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    setPayoutSkipped(window.localStorage.getItem(payoutSkipKey) === "true");
  }, [payoutSkipKey]);

  useEffect(() => {
    if (!profile?.id) return;
    window.localStorage.removeItem(storageKey);
  }, [profile?.id, storageKey]);

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

  function continueToProfileReview() {
    setExpandedStepId("dancer-profile-media");
    window.localStorage.setItem(storageKey, "dancer-profile-media");
    window.requestAnimationFrame(() => {
      document.getElementById("dancer-onboarding-profile-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
      const nextAction = document.getElementById("dancer-onboarding-profile-review-button") || document.getElementById("dancer-onboarding-profile-review");
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

  function beginPayoutLinkAction() {
    if (!mountedRef.current || payoutLinkInFlightRef.current) return null;
    payoutLinkInFlightRef.current = true;
    const requestId = ++payoutLinkSequenceRef.current;
    payoutLinkAbortRef.current?.abort();
    const controller = new AbortController();
    payoutLinkAbortRef.current = controller;
    return { requestId, controller };
  }

  function isCurrentPayoutLinkAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === payoutLinkSequenceRef.current;
  }

  function finishPayoutLinkAction(requestId: number) {
    if (requestId !== payoutLinkSequenceRef.current) return false;
    payoutLinkAbortRef.current = null;
    payoutLinkInFlightRef.current = false;
    return mountedRef.current;
  }

  async function submitProfile() {
    if (!profileReady) return;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in again before continuing to club verification.");
      return;
    }
    const action = beginProfileSubmissionAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsSubmitting(true);
    setStatus("Preparing your profile for club verification...");
    try {
      const data = await requestDancerProfileJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submitForReview: true }),
        fallbackMessage: "Unable to submit profile.",
        signal: controller.signal,
      });
      if (!isCurrentProfileSubmissionAction(requestId, controller)) return;
      if (!data.profile) throw new Error("Unable to submit profile.");
      const confirmedStatus = effectiveDancerProfileStatus(data.profile);
      if (confirmedStatus !== "pending_review" && confirmedStatus !== "approved") {
        throw new Error("Club verification was not unlocked. Please try again.");
      }
      onProfileChange?.(data.profile);
      window.localStorage.setItem(storageKey, "dancer-onboarding-payouts");
      setExpandedStepId("dancer-onboarding-payouts");
      setStatus("Profile submitted. Choose whether to set up payouts, then continue to the club tap.");
      window.requestAnimationFrame(() => {
        if (!isCurrentProfileSubmissionAction(requestId, controller)) return;
        document.getElementById("dancer-onboarding-payouts")?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("dancer-onboarding-payouts-button")?.focus({ preventScroll: true });
      });
    } catch (error) {
      if (isCurrentProfileSubmissionAction(requestId, controller)) {
        setStatus(error instanceof Error ? error.message : "Unable to submit profile.");
      }
    } finally {
      if (finishProfileSubmissionAction(requestId)) setIsSubmitting(false);
    }
  }

  function continueToNfc(message: string) {
    window.localStorage.setItem(storageKey, "dancer-onboarding-nfc");
    setExpandedStepId("dancer-onboarding-nfc");
    setPayoutStatus(message);
    window.requestAnimationFrame(() => {
      document.getElementById("dancer-onboarding-nfc")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("dancer-onboarding-nfc-button")?.focus({ preventScroll: true });
    });
  }

  function skipPayoutSetup() {
    if (payoutLinkInFlightRef.current) return;
    window.localStorage.setItem(payoutSkipKey, "true");
    setPayoutSkipped(true);
    continueToNfc("Payout setup saved for later.");
  }

  async function requestOnboardingNatsLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setPayoutStatus("Sign in again to set up payouts.");
    const action = beginPayoutLinkAction();
    if (!action) return;
    const { requestId, controller } = action;
    setIsPayoutWorking(true);
    setPayoutStatus("Submitting your payout account for verification...");
    try {
      const data = await requestDancerFinanceJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_nats_link", loginId: natsLoginId, username: natsUsername }),
        fallbackMessage: "Unable to link the payout account.",
        signal: controller.signal,
      });
      if (!isCurrentPayoutLinkAction(requestId, controller)) return;
      if (!["requested", "active"].includes(String(data.account?.status || ""))) {
        throw new Error("Payout account verification was not confirmed. Please try again.");
      }
      window.localStorage.removeItem(payoutSkipKey);
      setPayoutSkipped(false);
      continueToNfc("Payout account submitted for verification. You can complete the club tap now.");
    } catch (error) {
      if (isCurrentPayoutLinkAction(requestId, controller)) {
        setPayoutStatus(error instanceof Error ? error.message : "Unable to link the payout account.");
      }
    } finally {
      if (finishPayoutLinkAction(requestId)) setIsPayoutWorking(false);
    }
  }

  return (
    <section className="dancer-onboarding-command" aria-labelledby="dancer-onboarding-heading">
      <div className="dancer-onboarding-command-head">
        <span>
          <span className="eyebrow">Setup checklist</span>
          <h2 id="dancer-onboarding-heading">Profile setup</h2>
          <p>Create your profile, then activate it with your first club tap.</p>
        </span>
        <div className="dancer-onboarding-progress">
          <div className="dancer-onboarding-progress-track" role="progressbar" aria-label="Profile setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((step) => step.complete).length}>
            {steps.map((step) => <span className={step.complete ? "is-complete" : ""} key={step.id} />)}
          </div>
          <b>{steps.filter((step) => step.complete).length} of {steps.length} complete</b>
        </div>
      </div>
      <ol className="dancer-onboarding-steps" aria-label="Dancer profile approval progress">
        {steps.map((step, index) => {
          const open = visibleExpandedStepId === step.id;
          const isPayoutStep = step.id === "dancer-onboarding-payouts";
          const displayComplete = step.complete && (!isPayoutStep || natsAccountStatus === "active");
          const controlLabel = step.locked
            ? "Locked"
            : displayComplete
              ? "Complete"
              : step.id === "dancer-profile-media"
                ? profileStarted ? "Continue" : "Start"
                : isPayoutStep
                  ? natsSelected || natsAccountStatus === "requested" ? "Continue" : "Set up"
                  : "Verify";
          const controlTone = step.locked ? "locked" : displayComplete ? "complete" : "action";
          const panelId = `${step.id}-panel`;
          return (
            <li
              className={`${displayComplete ? "is-complete" : step.id === firstIncomplete.id ? "is-current" : ""} ${open ? "is-open" : ""} ${step.locked ? "is-locked" : ""} ${isPayoutStep && payoutSkipped ? "is-deferred" : ""}`.trim()}
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
                <span className="dancer-onboarding-step-marker" aria-hidden="true">{index + 1}</span>
                <span className="dancer-onboarding-step-copy">
                  <span className="dancer-onboarding-step-title">
                    <strong>{step.label}</strong>
                    {step.optional ? <em>Optional</em> : null}
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
                    {profileMediaContent({
                      continueToReview: continueToProfileReview,
                      profileReady,
                    })}
                    <div className="dancer-onboarding-preview-workspace dancer-onboarding-profile-review" id="dancer-onboarding-profile-review" tabIndex={-1}>
                      {submitted ? (
                        <div className="dancer-onboarding-complete-note" role="status">
                          <strong>✓ Step 1 complete</strong>
                          <span>Your profile is ready. Set up payouts now or later, then complete the dressing-room tap.</span>
                        </div>
                      ) : (
                        <button className="dancer-onboarding-primary" id="dancer-onboarding-profile-review-button" aria-describedby="dancer-onboarding-profile-review-status" aria-busy={isSubmitting} type="button" disabled={isSubmitting || !profileReady} onClick={() => void submitProfile()}>
                          {isSubmitting ? "Preparing..." : "Continue to club verification"}
                        </button>
                      )}
                      <p className="dancer-onboarding-announcement" id="dancer-onboarding-profile-review-status" role="status" aria-live="polite">
                        {status || (!profileReady && !submitted ? setupDetail : "")}
                      </p>
                    </div>
                  </>
                ) : null}
                {step.id === "dancer-onboarding-payouts" ? (
                  <div className="dancer-onboarding-payout-workspace">
                    <article className="dancer-onboarding-payout-card">
                      <span className="eyebrow">Optional</span>
                      <h3>Commission payouts</h3>
                      <p>Club Deals stay on your profile. Commissions start only after your payout account is verified. Earlier redemptions do not earn commissions or back pay.</p>
                      {natsAccountStatus === "active" ? <strong className="dancer-onboarding-payout-state is-active">✓ Payout account connected</strong> : null}
                      {natsAccountStatus === "requested" ? <strong className="dancer-onboarding-payout-state">Verification pending</strong> : null}
                      {natsPortalUrl ? <a className="dancer-onboarding-preview-open" href={natsPortalUrl} rel="noreferrer" target="_blank">Create or open payout account</a> : null}
                      {natsSelected && !payoutSubmitted ? (
                        <form className="account-form dancer-onboarding-payout-form" onSubmit={requestOnboardingNatsLink}>
                          <label>Payout account login ID <span>from your payout portal</span><input required inputMode="numeric" pattern="[1-9][0-9]*" value={natsLoginId} onChange={(event) => setNatsLoginId(event.target.value)} /></label>
                          <label>Payout account username <span>optional</span><input autoCapitalize="none" maxLength={80} value={natsUsername} onChange={(event) => setNatsUsername(event.target.value)} /></label>
                          <button disabled={isPayoutWorking || !natsConfigured} type="submit">{isPayoutWorking ? "Submitting..." : "Submit payout account"}</button>
                        </form>
                      ) : null}
                    </article>
                    <div className="dancer-onboarding-payout-actions">
                      {payoutSubmitted ? <button className="dancer-onboarding-primary" type="button" onClick={() => continueToNfc("Payout setup recorded. Continue with the official club tap.")}>Continue to club tap</button> : null}
                      <button className="dancer-onboarding-secondary" disabled={isPayoutWorking} type="button" onClick={skipPayoutSetup}>Do this later</button>
                    </div>
                    {payoutStatus ? <p className="dancer-onboarding-announcement" role="status" aria-live="polite">{payoutStatus}</p> : null}
                  </div>
                ) : null}
                {step.id === "dancer-onboarding-nfc" ? venueVerificationContent : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}


function dancerPreviewSocialLinks(profile?: LoadState["profile"]) {
  const rows = Array.isArray(profile?.social_links) ? profile.social_links : [];
  return rows.flatMap((value, index) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
    const platform = String(row?.platform || "").toLowerCase() as SocialPlatform;
    const url = String(row?.url || "").trim();
    if (!row || row.is_active === false || !DANCER_PREVIEW_SOCIAL_PLATFORMS.has(platform) || !url) return [];
    return [{
      id: String(row.id || `preview-${platform}-${index}`),
      platform,
      handle: String(row.handle || ""),
      url,
    }];
  });
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
  if (pendingAvatar) return "Your avatar is being moderated.";
  if (!avatarUrl) return "Upload a clear face avatar.";
  if (pendingPhotos.length) return `${pendingPhotos.length} profile ${pendingPhotos.length === 1 ? "picture is" : "pictures are"} still being moderated.`;
  if (rejectedPhotos.length) return "Replace the profile picture that did not pass moderation.";
  if (!approvedPhotos.length) return "Upload at least one profile picture that passes moderation.";
  return "Save the remaining profile changes.";
}


function persistedStageNameAndCity(profile?: LoadState["profile"]) {
  return Boolean(persistedDancerStageName(profile) && String(profile?.city || "").trim());
}


function dancerStepOneStateLabel(state: DancerStepOneItemState) {
  if (state === "complete") return "Complete";
  if (state === "checking") return "Checking";
  if (state === "replace") return "Choose another";
  if (state === "unsaved") return "Unsaved changes";
  return "Missing";
}


export function DancerOnboardingProfileMediaWorkspace({
  avatarContent,
  continueToReview,
  draftIdentity,
  identityContent,
  photoContent,
  onProfileChange,
  profile,
  profileReady,
  socialContent,
  videoContent,
}: {
  avatarContent: ReactNode;
  continueToReview: () => void;
  draftIdentity: DancerIdentityDraft;
  identityContent: ReactNode;
  photoContent: ReactNode;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  profileReady: boolean;
  socialContent: DancerProfileSocialEditor;
  videoContent: ReactNode;
}) {
  const persistedStageName = persistedDancerStageName(profile);
  const persistedCity = String(profile?.city || "").trim();
  const pendingAvatar = profile?.pending_avatar_review as Record<string, unknown> | undefined;
  const avatarUrl = String(profile?.avatarPhotoUrl || "").trim();
  const photos = dancerPhotoItemsFromProfile(profile);
  const approvedPhotos = photos.filter((photo) => photo.status === "approved");
  const pendingPhotos = photos.filter((photo) => photo.status === "pending");
  const rejectedPhotos = photos.filter((photo) => photo.status === "rejected");
  const draftChanged = draftIdentity.stageName.trim() !== persistedStageName
    || draftIdentity.city.trim() !== persistedCity;
  const identityState: DancerStepOneItemState = draftChanged
    ? "unsaved"
    : persistedStageName && persistedCity
      ? "complete"
      : "missing";
  const avatarState: DancerStepOneItemState = pendingAvatar
    ? "checking"
    : avatarUrl
      ? "complete"
      : "missing";
  const photoState: DancerStepOneItemState = approvedPhotos.length
    ? "complete"
    : pendingPhotos.length
      ? "checking"
      : rejectedPhotos.length
        ? "replace"
        : "missing";
  const photoDetail = [
    `${photos.length} ${photos.length === 1 ? "picture" : "pictures"} added`,
    `${approvedPhotos.length} approved`,
    pendingPhotos.length ? `${pendingPhotos.length} checking` : "",
    rejectedPhotos.length ? `${rejectedPhotos.length} needs replacement` : "",
  ].filter(Boolean).join(" · ");
  const [continueAfterSave, setContinueAfterSave] = useState(false);
  const readyAfterSave = Boolean(
    draftIdentity.stageName.trim()
    && draftIdentity.city.trim()
    && avatarUrl
    && approvedPhotos.length,
  );

  useEffect(() => {
    if (!continueAfterSave || !profileReady) return;
    setContinueAfterSave(false);
    continueToReview();
  }, [continueAfterSave, continueToReview, profileReady]);

  async function saveAndContinue() {
    if (!readyAfterSave) return false;
    const saved = await saveDancerProfileEditor();
    if (saved) setContinueAfterSave(true);
    return saved;
  }

  const builderRequirements: DancerProfileBuilderRequirement[] = [
    { complete: Boolean(draftIdentity.stageName.trim() && draftIdentity.city.trim()), label: "Stage name & city", section: "identity", status: dancerStepOneStateLabel(identityState) },
    { complete: avatarState === "complete", label: "Avatar", section: "avatar", status: dancerStepOneStateLabel(avatarState) },
    { complete: photoState === "complete", label: "Profile photo", section: "photos", status: photoDetail },
  ];
  const editorSections: DancerProfileEditorSections = {
    identity: identityContent,
    avatar: avatarContent,
    photos: photoContent,
    videos: videoContent,
    socials: socialContent,
  };

  return (
    <article className="dancer-profile-editor-launch-card" data-ready={profileReady} aria-labelledby="dancer-profile-setup-launch-heading">
      <span>
        <strong id="dancer-profile-setup-launch-heading">Profile details</strong>
        <small>Stage name, city, avatar and at least 1 solo photo.</small>
      </span>
      <DancerProfilePreview
        builderRequirements={builderRequirements}
        buttonClassName="dancer-profile-editor-launch-button"
        buttonLabel={profileReady ? "Edit profile" : "Set up profile"}
        city={draftIdentity.city}
        editorSections={editorSections}
        name={draftIdentity.stageName}
        onEditorSave={saveAndContinue}
        onProfileChange={onProfileChange}
        profile={profile}
        saveLabel="Save & continue"
      />
    </article>
  );
}
