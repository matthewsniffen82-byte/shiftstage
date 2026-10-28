"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { requestDashboardJson, requestDancerPhotosJson, requestDancerTvVideoJson, requestDancerMediaPin } from "./dashboard-session";
import { announceDancerProfileVideosChanged } from "./dancer-profile-media-sync";
import DancerVideoThumbnail from "./DancerVideoThumbnail";
import DancerMediaPinButton from "./DancerMediaPinButton";
import DancerMediaViewer from "./DancerMediaViewer";
import DancerMediaRetryButton from "./DancerMediaRetryButton";
import { mediaRejectionLabel, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";
import { MAX_DANCER_PROFILE_PHOTOS, MAX_DANCER_PROFILE_VIDEOS } from "@/src/lib/dancr/media-limits";
import type { MediaLibraryItem } from "./media-library-items";
import { mediaClubStatuses, mediaClubRejection, type ClubMediaState, type ClubMediaStatus } from "@/src/lib/dancr/club-media-status";

type UploadItem = MediaLibraryItem;

export function profileUploadStatus(status: string, moderationStatus?: string, kind: "photo" | "video" = "photo") {
  return ["rejected", "denied"].includes(status) ? mediaRejectionLabel(kind) : mediaReviewLabel(status, moderationStatus, kind);
}

export default function DancerProfileMediaUploads({
  photos,
  videos,
  isApproved,
  isPublic,
  isVideoLoading,
  videoError,
  onOpen,
  onPhotoDeleted,
  onVideoDeleted,
  onDeleteBusyChange,
  onMediaPinned,
  onProfileChange,
  compact = false,
  expanded = false,
  mediaType,
  disabled = false,
  photoActions,
  photoAccessory,
  slotEditor = false,
  onAdd,
  clubMedia,
}: {
  clubMedia?: ClubMediaState;
  slotEditor?: boolean;
  onAdd?: () => void;
  compact?: boolean;
  expanded?: boolean;
  mediaType?: "photos" | "videos";
  disabled?: boolean;
  photoActions?: (id: string) => ReactNode;
  photoAccessory?: (id: string) => ReactNode;
  photos: UploadItem[];
  videos: UploadItem[];
  isApproved: boolean;
  isPublic: boolean;
  isVideoLoading: boolean;
  videoError: string;
  onOpen: (section: "photos" | "videos") => void;
  onPhotoDeleted: (photoId: string) => void;
  onVideoDeleted: (videoId: string) => void;
  onDeleteBusyChange?: (busy: boolean) => void;
  onMediaPinned?: (mediaType: "photo" | "video", mediaId: string, pinned: boolean) => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
}) {
  const [loadedClubStatuses, setClubStatuses] = useState<ClubMediaStatus[]>([]);
  const [loadedClubError, setClubError] = useState("");
  const clubStatuses = clubMedia?.statuses || loadedClubStatuses;
  const clubError = clubMedia?.error ?? loadedClubError;
  const hasSharedClubMedia = Boolean(clubMedia);
  const mediaKey = [...photos, ...videos].map(item => item.id + item.status).join(":");
  useEffect(() => {
    if (hasSharedClubMedia) return;
    const controller = new AbortController();
    requestDashboardJson("/api/dancer/club-media", { expectedRole: "dancer", cache: "no-store", signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setClubStatuses(data.statuses || []); setClubError(""); } })
      .catch(() => { if (!controller.signal.aborted) setClubError("Club approvals are temporarily unavailable."); });
    return () => controller.abort();
  }, [mediaKey, hasSharedClubMedia]);
  const clubLabels = (item: UploadItem, kind: string) => mediaClubStatuses(clubStatuses, item.id, kind);
  const rejection = (item: UploadItem, kind: "photo" | "video") => ["rejected", "denied"].includes(item.status) ? mediaRejectionLabel(kind) : mediaClubRejection(clubStatuses, item.id, kind);
  const itemStatus = (item: UploadItem, kind: "photo" | "video") => rejection(item, kind) || profileUploadStatus(item.status, item.moderationStatus, kind);
  const needsAttention = (item: UploadItem, kind: "photo" | "video") => Boolean(item.upload?.error || rejection(item, kind))
    || ["Not approved", "Upload failed", "Review delayed"].includes(profileUploadStatus(item.status, item.moderationStatus, kind));
  const [deletingPhotoId, setDeletingPhotoId] = useState("");
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<Set<string>>(() => new Set());
  const [photoStatus, setPhotoStatus] = useState("");
  const [deletingVideoId, setDeletingVideoId] = useState("");
  const [deletedVideoIds, setDeletedVideoIds] = useState<Set<string>>(() => new Set());
  const [videoStatus, setVideoStatus] = useState("");
  const [pinningId, setPinningId] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [visibleSlots, setVisibleSlots] = useState({ photos: 9, videos: 9 });
  const [activePreview, setActivePreview] = useState<{ kind: "photo" | "video"; id: string; label: string } | null>(null);
  const previewItem = activePreview && (activePreview.kind === "photo" ? photos : videos).find((item) => item.id === activePreview.id);
  const deleteRequestRef = useRef<AbortController | null>(null);
  const isDeleting = Boolean(deletingPhotoId || deletingVideoId || pinningId);
  const actionsDisabled = isDeleting || retrying || disabled;

  useEffect(() => () => {
    deleteRequestRef.current?.abort();
    deleteRequestRef.current = null;
    onDeleteBusyChange?.(false);
  }, [onDeleteBusyChange]);

  async function deletePreviewPhoto(photoId: string) {
    if (deleteRequestRef.current || deletedPhotoIds.has(photoId)) return;
    if (!window.confirm("Delete this photo from your profile?")) return;
    const controller = new AbortController();
    deleteRequestRef.current = controller;
    onDeleteBusyChange?.(true);
    const isCurrent = () => deleteRequestRef.current === controller && !controller.signal.aborted;
    setDeletingPhotoId(photoId);
    // Hide immediately, but only update the saved profile after confirmation.
    setDeletedPhotoIds((current) => new Set(current).add(photoId));
    setPhotoStatus("Deleting photo…");
    try {
      await requestDancerPhotosJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId }),
        fallbackMessage: "Unable to delete photo. Try again.",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      onPhotoDeleted(photoId);
      setPhotoStatus("");
    } catch (error) {
      if (isCurrent()) {
        setDeletedPhotoIds((current) => {
          const next = new Set(current);
          next.delete(photoId);
          return next;
        });
        setPhotoStatus(error instanceof Error ? error.message : "Unable to delete photo. Try again.");
      }
    } finally {
      if (isCurrent()) {
        deleteRequestRef.current = null;
        onDeleteBusyChange?.(false);
        setDeletingPhotoId("");
      }
    }
  }

  async function deletePreviewVideo(videoId: string) {
    if (deleteRequestRef.current || deletedVideoIds.has(videoId)) return;
    if (!window.confirm("Delete this video from your profile?")) return;
    const controller = new AbortController();
    deleteRequestRef.current = controller;
    onDeleteBusyChange?.(true);
    const isCurrent = () => deleteRequestRef.current === controller && !controller.signal.aborted;
    setDeletingVideoId(videoId);
    setVideoStatus("");
    try {
      await requestDancerTvVideoJson(videoId, {
        method: "DELETE",
        fallbackMessage: "Unable to delete video. Try again.",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      setDeletedVideoIds((current) => new Set(current).add(videoId));
      onVideoDeleted(videoId);
      announceDancerProfileVideosChanged();
      setVideoStatus("");
    } catch (error) {
      if (isCurrent()) setVideoStatus(error instanceof Error ? error.message : "Unable to delete video. Try again.");
    } finally {
      if (isCurrent()) {
        deleteRequestRef.current = null;
        onDeleteBusyChange?.(false);
        setDeletingVideoId("");
      }
    }
  }

  async function pinPreview(mediaType: "photo" | "video", item: UploadItem) {
    if (deleteRequestRef.current || item.status !== "approved") return;
    const controller = new AbortController();
    deleteRequestRef.current = controller;
    onDeleteBusyChange?.(true);
    const isCurrent = () => deleteRequestRef.current === controller && !controller.signal.aborted;
    setPinningId(item.id);
    const setMessage = mediaType === "photo" ? setPhotoStatus : setVideoStatus;
    setMessage("");
    try {
      const saved = await requestDancerMediaPin(mediaType, item.id, !item.isPinned, controller.signal);
      if (!isCurrent()) return;
      onMediaPinned?.(mediaType, item.id, saved.isPinned);
      if (mediaType === "video") announceDancerProfileVideosChanged();
      setMessage(`${mediaType === "photo" ? "Photo" : "Video"} ${saved.isPinned ? "pinned" : "unpinned"}.`);
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : "Unable to save the pin. Try again.");
    } finally {
      if (isCurrent()) {
        deleteRequestRef.current = null;
        onDeleteBusyChange?.(false);
        setPinningId("");
      }
    }
  }

  return (
    <section className={`dancer-profile-media-uploads${compact ? " is-compact" : ""}`} aria-label={mediaType === "photos" ? "Uploaded photos" : mediaType === "videos" ? "Uploaded videos" : "Add profile photos and videos"}>
      {clubError ? <p role="status">{clubError}</p> : null}
      {(["photos", "videos"] as const).map((section) => {
        if (mediaType && section !== mediaType) return null;
        const isPhoto = section === "photos";
        const label = isPhoto ? "Photo" : "Video";
        const items = isPhoto ? photos.filter((photo) => !deletedPhotoIds.has(photo.id)) : videos.filter((video) => !deletedVideoIds.has(video.id));
        if (compact && !slotEditor && !items.length && (isPhoto || (!isVideoLoading && !videoError))) return null;
        const capacity = isPhoto ? MAX_DANCER_PROFILE_PHOTOS : MAX_DANCER_PROFILE_VIDEOS;
        const emptySlots = slotEditor ? Math.max(0, Math.min(capacity, Math.max(visibleSlots[section], Math.ceil(items.length / 9) * 9)) - items.length) : 0;
        const slotsToAdd = slotEditor ? Math.max(0, Math.min(9, capacity - items.length - emptySlots)) : 0;
        const Group = compact && !expanded ? "details" : "div";
        const Heading = compact && !expanded ? "summary" : "header";
        return (
          <Group className="profile-upload-group" key={section}>
            <Heading>
              <strong>{isPhoto ? "Photos" : "Videos"}</strong>
              {!compact ? <small>{isPhoto ? "Only you in each photo" : "Optional · add now or later"}</small> : null}
              <span>{!isPhoto && isVideoLoading ? "Loading…" : !isPhoto && videoError ? "Unavailable" : `${items.length} added`}</span>
            </Heading>
            {!compact ? <><p>{isPhoto ? "You can add more photos later." : "You can add videos now or later."}</p>
            <button className="profile-upload-entry" data-profile-editor-trigger={section} disabled={actionsDisabled} onClick={() => onOpen(section)} type="button">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                {isPhoto ? <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8" cy="9" r="1.5" /><path d="m5 17 4-4 3 3 3-4 4 5" /></> : <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></>}
              </svg>
              <span><strong>Add {label.toLowerCase()}</strong><small>Camera or phone files</small></span>
              <b aria-hidden="true">+</b>
            </button>
            </> : null}
            {items.length || emptySlots ? (
              <ul className="profile-upload-items" aria-label={`Uploaded ${section}`}>
                {items.map((item, index) => item.upload && slotEditor ? (
                  <li key={item.previewKey || item.id} data-review-status={item.status} data-rejected={Boolean(rejection(item, isPhoto ? "photo" : "video")) || undefined} data-needs-attention={needsAttention(item, isPhoto ? "photo" : "video") || undefined}>
                    <div className="profile-upload-preview dancer-media-uploading-slot" aria-busy={!item.upload.error}>
                      <span className="profile-upload-thumbnail">
                        {isPhoto ? <img src={item.imageUrl || undefined} alt="" /> : <DancerVideoThumbnail posterUrl={item.imageUrl} videoUrl={item.videoUrl} />}
                      </span>
                      {item.isPrimary ? <span className="dancer-main-photo-badge">Main photo</span> : null}
                      <div className="dancer-media-slot-progress" title={item.upload.error}>
                        <span role="status">{rejection(item, isPhoto ? "photo" : "video") || item.upload.label}{!item.upload.error && item.upload.progress !== undefined ? ` · ${item.upload.progress}%` : ""}</span>
                        {!item.upload.error ? <span className={`dancer-upload-progress${item.upload.progress === undefined ? " is-indeterminate" : ""}`}
                          role="progressbar" aria-label={`${label} ${index + 1}: ${item.upload.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.upload.progress}>
                          <span style={item.upload.progress === undefined ? undefined : { width: `${item.upload.progress}%` }} />
                        </span> : !rejection(item, isPhoto ? "photo" : "video") ? <small>{item.upload.error.replace(/(?:tap )?retry/gi, "remove this item and add it again")}</small> : null}
                      </div>
                      <button type="button" className="dancer-media-slot-remove" data-close-control=""
                        aria-label={`${item.upload.error ? "Remove" : "Cancel"} ${label.toLowerCase()} ${index + 1}`} disabled={item.upload.removing}
                        onClick={item.upload.onRemove}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={item.previewKey || item.id} data-review-status={item.status} data-rejected={Boolean(rejection(item, isPhoto ? "photo" : "video")) || undefined} data-needs-attention={needsAttention(item, isPhoto ? "photo" : "video") || undefined}>
                    {!compact ? <div>{clubLabels(item, isPhoto ? "photo" : "video").filter(club => club.status !== "rejected").map(club => <small key={club.venueId} data-club-status={club.status}>{club.venueName}: {club.status === "approved" ? "Approved here" : club.status === "rejected" ? "Not approved here" : "Pending here"}<br /></small>)}</div> : null}
                    <div className="profile-upload-preview">
                      {isPhoto && item.isPrimary ? <span className="dancer-main-photo-badge">Main photo</span> : null}
                      {slotEditor && rejection(item, isPhoto ? "photo" : "video") ? <span className="dancer-media-rejected-indicator" role="status" title={rejection(item, isPhoto ? "photo" : "video")} aria-label={rejection(item, isPhoto ? "photo" : "video")}>{rejection(item, isPhoto ? "photo" : "video")}</span> : slotEditor && profileUploadStatus(item.status, item.moderationStatus, isPhoto ? "photo" : "video") === "Awaiting final approval" ?
                        <span className="dancer-media-approval-indicator" role="img" aria-label="Awaiting final approval" title="Awaiting final approval">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>
                        </span> : null}
                      <button aria-label={`${isPhoto ? compact ? "Edit" : "View" : "Play"} ${label.toLowerCase()} ${index + 1}: ${itemStatus(item, isPhoto ? "photo" : "video")}`} disabled={Boolean(deletingVideoId || pinningId) || disabled} onClick={event => {
                        if (compact && isPhoto) {
                          const options = event.currentTarget.parentElement?.querySelector<HTMLDetailsElement>("details.dancer-thumbnail-menu");
                          if (options) options.open = true;
                        } else setActivePreview({ kind: isPhoto ? "photo" : "video", id: item.id, label: `${label} ${index + 1}` });
                      }} type="button">
                        <span className="profile-upload-thumbnail">
                          {isPhoto
                            ? item.imageUrl ? <img alt="" loading="lazy" src={item.imageUrl} /> : <span aria-hidden="true">▧</span>
                            : <DancerVideoThumbnail posterUrl={item.imageUrl} videoUrl={item.videoUrl} />}
                          {!isPhoto ? <i aria-hidden="true">▶</i> : null}
                        </span>
                      </button>
                      {isPhoto && item.isPinned ? <svg className="dancer-photo-pin-indicator" role="img" aria-label="Pinned photo" viewBox="0 0 24 24"><path d="m16 3 5 5-4 1-3 5-4-4 5-3 1-4Z" /><path d="m9 9 6 6M12 12l-7 7" /></svg> : null}
                      {slotEditor ? <button type="button" className="dancer-media-slot-remove" data-close-control="" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} disabled={actionsDisabled}
                        onClick={() => void (isPhoto ? deletePreviewPhoto(item.id) : deletePreviewVideo(item.id))}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                      </button> : null}
                      {compact ? <details className="dancer-thumbnail-menu" data-compact-menu name="dancer-media-options"><summary className="dashboard-menu-trigger" aria-label={`Options for ${label.toLowerCase()} ${index + 1}`}><span className="dashboard-menu-dots" aria-hidden="true">•••</span></summary><div>
                        <p className="profile-upload-menu-caption" data-needs-attention={needsAttention(item, isPhoto ? "photo" : "video") || undefined}>{label} {index + 1} · {itemStatus(item, isPhoto ? "photo" : "video")}</p>
                        {clubLabels(item, isPhoto ? "photo" : "video").filter(club => club.status !== "rejected").map(club => <p key={club.venueId} data-club-status={club.status}>{club.venueName}: {club.status === "approved" ? "Approved here" : club.status === "rejected" ? "Not approved here" : "Pending here"}</p>)}
                        {clubError ? <p role="status">{clubError}</p> : null}
                        {isPhoto ? photoActions?.(item.id) : null}
                        {isPhoto ? <button type="button" disabled={actionsDisabled} onClick={() => setActivePreview({ kind: "photo", id: item.id, label: `${label} ${index + 1}` })}>View photo</button> : null}
                        {onMediaPinned ? <button type="button" disabled={actionsDisabled || item.status !== "approved"} onClick={() => void pinPreview(isPhoto ? "photo" : "video", item)}>{item.isPinned ? "Unpin" : "Pin"}</button> : null}
                        <button type="button" disabled={actionsDisabled} onClick={() => void (isPhoto ? deletePreviewPhoto(item.id) : deletePreviewVideo(item.id))}>Delete</button>
                      </div></details> : <>
                      {onMediaPinned ? <DancerMediaPinButton available={item.status === "approved"} label={`${label.toLowerCase()} ${index + 1}`} pinned={item.isPinned} busy={pinningId === item.id} disabled={actionsDisabled} onClick={() => void pinPreview(isPhoto ? "photo" : "video", item)} /> : null}
                      <button
                        aria-label={`${(isPhoto ? deletingPhotoId : deletingVideoId) === item.id ? "Deleting" : "Delete"} ${label.toLowerCase()} ${index + 1}`}
                        aria-busy={(isPhoto ? deletingPhotoId : deletingVideoId) === item.id}
                        className="profile-upload-delete"
                        disabled={actionsDisabled}
                        onClick={() => void (isPhoto ? deletePreviewPhoto(item.id) : deletePreviewVideo(item.id))}
                        type="button"
                      >
                        <span className="profile-upload-delete-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
                        </span>
                      </button>
                      </>}
                    </div>
                    {isPhoto ? photoAccessory?.(item.id) : null}
                    {!slotEditor ? <strong>{label} {index + 1}</strong> : null}
                    {!slotEditor || (!rejection(item, isPhoto ? "photo" : "video") && item.status !== "approved" && profileUploadStatus(item.status, item.moderationStatus, isPhoto ? "photo" : "video") !== "Awaiting final approval") ?
                      <small className={item.status === "approved" ? "is-ready" : ""}>{profileUploadStatus(item.status, item.moderationStatus, isPhoto ? "photo" : "video")}</small> : null}
                    {!slotEditor ? <DancerMediaRetryButton key={item.id} id={item.id} kind={isPhoto ? "photo" : "video"} status={item.status} moderationStatus={item.moderationStatus}
                      disabled={actionsDisabled} onBusyChange={busy => { setRetrying(busy); onDeleteBusyChange?.(busy); }}
                      onRetried={({ profile }) => { if (profile) onProfileChange?.(profile); }} /> : null}
                    {["rejected", "denied", "failed", "uploading"].includes(item.status) ? <button className="dancer-upload-replace" type="button" disabled={actionsDisabled} onClick={() => onOpen(section)}>Upload replacement</button> : null}
                  </li>
                ))}
                {Array.from({ length: emptySlots }, (_, index) => <li key={`add-${index}`} className="dancer-media-empty-slot">
                  <button type="button" className="dancer-media-slot-add" aria-label={`Add ${label.toLowerCase()}`} disabled={actionsDisabled || (!isPhoto && isVideoLoading)} onClick={() => onAdd?.()}><span aria-hidden="true">+</span></button>
                </li>)}
              </ul>
            ) : null}
            {slotsToAdd ? <button type="button" className="dancer-media-more-slots" aria-label={`Add ${slotsToAdd} more ${label.toLowerCase()} slots`}
              disabled={actionsDisabled || (!isPhoto && isVideoLoading)}
              onClick={() => setVisibleSlots(current => ({ ...current, [section]: items.length + emptySlots + slotsToAdd }))}>
              <span aria-hidden="true">+</span> Add {slotsToAdd} more
            </button> : null}
            {isPhoto && photoStatus ? <p role="status" aria-live="polite">{photoStatus}</p> : null}
            {!isPhoto && videoStatus ? <p role="status" aria-live="polite">{videoStatus}</p> : null}
            {!isPhoto && videoError ? <p role="status">{videoError} {!slotEditor ? <button className="profile-upload-retry" onClick={() => announceDancerProfileVideosChanged()} type="button">Retry</button> : null}</p> : null}
          </Group>
        );
      })}
      {!compact || isApproved ? <p className="profile-upload-visibility" role="status" aria-live="polite">
        {isApproved ? <>
          <span aria-hidden={!isPublic}>Approved uploads appear on your profile.</span>
          <span aria-hidden={isPublic}>Uploads stay saved. Hidden while incognito.</span>
        </> : "Uploaded photos and videos will appear on your profile after club approval and completion of your profile setup."}
      </p> : null}
      {activePreview && previewItem ? <DancerMediaViewer key={`${activePreview.kind}:${activePreview.id}`} kind={activePreview.kind} label={activePreview.label} imageUrl={previewItem.imageUrl} videoUrl={previewItem.videoUrl} onClose={() => setActivePreview(null)} /> : null}
      <style>{`
        .dancer-profile-media-uploads { width:min(100%,760px); min-width:0; display:grid; gap:16px; margin:12px auto 0; }
        .profile-upload-group { min-width:0; display:grid; gap:9px; }
        .profile-upload-group > header { display:flex; align-items:baseline; flex-wrap:wrap; gap:6px 10px; }
        .profile-upload-group > header strong { color:#fff; font-size:18px; line-height:1.3; }
        .profile-upload-group > header small { color:#bdb7c9; font-size:12px; }
        .profile-upload-group > header > span { margin-left:auto; color:#c9c3d2; font-size:12px; }
        .dancer-profile-media-uploads .profile-upload-entry { width:100%; min-width:0; min-height:78px; display:flex; align-items:center; gap:14px; padding:14px 16px; border:1px solid var(--dancr-color-border); border-radius:16px; color:#fff; background:linear-gradient(120deg,var(--dancr-color-surface-card),var(--dancr-color-surface-card)); text-align:left; font:inherit; cursor:pointer; }
        .profile-upload-entry > svg { width:28px; height:28px; flex:0 0 28px; fill:none; stroke:#d5baff; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .profile-upload-entry > span { min-width:0; display:grid; gap:4px; }
        .profile-upload-entry strong { color:#fff; font-size:16px; line-height:1.2; }
        .profile-upload-entry small { color:#d4cedd !important; -webkit-text-fill-color:currentColor !important; font-size:12px; line-height:1.3; }
        .profile-upload-entry > b { margin-left:auto; color:#e4d5ff; font-size:26px; line-height:1; }
        .profile-upload-items { min-width:0; display:flex; gap:10px; overflow-x:auto; margin:0; padding:2px 0 8px; list-style:none; }
        .profile-upload-items > li { flex:0 0 112px; min-width:0; display:grid; align-content:start; gap:4px; }
        .profile-upload-preview { position:relative; min-width:0; }
        .profile-upload-menu-caption { display:none; }
        .dancer-profile-media-uploads .profile-upload-items button { width:100%; min-height:44px; display:grid; gap:4px; padding:0; border:0; border-radius:8px; background:transparent; color:#fff; text-align:left; font:inherit; cursor:pointer; }
        .profile-upload-thumbnail { position:relative; width:100%; height:auto; aspect-ratio:3 / 4; display:grid; place-items:center; overflow:hidden; border:1px solid var(--dancr-color-border); border-radius:8px; background:var(--dancr-color-surface-card); color:#c9c3d2; }
        .profile-upload-thumbnail img { width:100%; height:100%; display:block; object-fit:cover; }
        .profile-upload-thumbnail i { position:absolute; inset:50% auto auto 50%; transform:translate(-50%,-50%); display:grid; place-items:center; width:32px; height:32px; border-radius:50%; background:#000b; color:#fff; font-size:14px; font-style:normal; }
        .profile-upload-items strong { font-size:12px; line-height:1.3; }
        .profile-upload-items small { color:#d4c3e9; font-size:11px; line-height:1.35; }
        .profile-upload-items small.is-ready { color:#8ce4b2; }
        .profile-upload-group > p { margin:0; color:#c9c3d2; font-size:12px; line-height:1.5; }
        .dancer-profile-media-uploads .profile-upload-visibility { box-sizing:border-box; display:grid; width:100%; margin:4px 0 16px; padding:14px 12px 0; border-top:1px solid var(--dancr-color-border); color:#c9c3d2; font-size:12px; line-height:1.5; text-align:center; text-wrap:pretty; }
        /* Measure both messages in the same cell so toggling cannot resize the gallery. */
        .profile-upload-visibility > span { grid-area:1 / 1; }
        .profile-upload-visibility > span[aria-hidden="true"] { visibility:hidden; }
        .dancer-profile-media-uploads .profile-upload-retry { min-height:44px; padding:6px 0; border:0; background:transparent; color:#fff; font:inherit; text-decoration:underline; cursor:pointer; }
        .dancer-profile-media-uploads button:focus-visible { outline:2px solid #fff; outline-offset:3px; }
        body.dancr-button-system .dancer-profile-media-uploads .profile-upload-entry { min-height:78px !important; padding:14px 16px !important; border-radius:16px !important; background:linear-gradient(120deg,var(--dancr-color-surface-card),var(--dancr-color-surface-card)) !important; box-shadow:none !important; }
        body.dancr-button-system .dancer-profile-media-uploads .profile-upload-items button { padding:0 !important; border:0 !important; border-radius:8px !important; background:transparent !important; box-shadow:none !important; }
        .dancer-profile-media-uploads .profile-upload-items .profile-upload-delete,
        body.dancr-button-system .dancer-profile-media-uploads .profile-upload-items .profile-upload-delete { position:absolute; right:2px; bottom:2px; z-index:1; display:grid; place-items:center; width:44px !important; height:44px !important; min-height:44px; margin:0; padding:0 !important; border:0 !important; background:transparent !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; color:#fff !important; }
        .profile-upload-delete-icon { width:30px; height:30px; display:grid; place-items:center; justify-self:end; border:1px solid rgba(255,255,255,.4); border-radius:50%; background:rgba(0,0,0,.78); box-shadow:0 1px 5px rgba(0,0,0,.35); }
        .profile-upload-delete-icon svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .dancer-profile-media-uploads button:disabled { opacity:.55; cursor:wait; }
      `}</style>
    </section>
  );
}
