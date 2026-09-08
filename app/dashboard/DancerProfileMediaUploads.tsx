"use client";

import { useEffect, useRef, useState } from "react";
import { requestDancerPhotosJson, requestDancerProfileJson, requestDancerTvVideoJson, requestDancerMediaPin } from "./dashboard-session";
import { announceDancerProfileVideosChanged } from "./dancer-profile-media-sync";
import DancerVideoThumbnail from "./DancerVideoThumbnail";
import DancerMediaPinButton from "./DancerMediaPinButton";

type UploadItem = {
  id: string;
  isPinned?: boolean;
  imageUrl?: string | null;
  videoUrl?: string | null;
  status: string;
};

export function profileUploadStatus(status: string) {
  switch (status) {
    case "approved": return "Approved";
    case "uploading": return "Upload incomplete";
    case "pending":
    case "moderating":
    case "submitted":
    case "review": return "Checking";
    case "rejected": return "Not approved";
    case "failed": return "Upload failed · Try again";
    default: return "Check upload status";
  }
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
}: {
  photos: UploadItem[];
  videos: UploadItem[];
  isApproved: boolean;
  isPublic: boolean;
  isVideoLoading: boolean;
  videoError: string;
  onOpen: (section: "photos" | "videos") => void;
  onPhotoDeleted: (photoId: string, profile?: Record<string, unknown>) => void;
  onVideoDeleted: (videoId: string) => void;
  onDeleteBusyChange?: (busy: boolean) => void;
  onMediaPinned?: (mediaType: "photo" | "video", mediaId: string, pinned: boolean) => void;
}) {
  const [deletingPhotoId, setDeletingPhotoId] = useState("");
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<Set<string>>(() => new Set());
  const [photoStatus, setPhotoStatus] = useState("");
  const [deletingVideoId, setDeletingVideoId] = useState("");
  const [deletedVideoIds, setDeletedVideoIds] = useState<Set<string>>(() => new Set());
  const [videoStatus, setVideoStatus] = useState("");
  const [pinningId, setPinningId] = useState("");
  const deleteRequestRef = useRef<AbortController | null>(null);
  const isDeleting = Boolean(deletingPhotoId || deletingVideoId || pinningId);

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
    setPhotoStatus("");
    let deleted = false;
    try {
      await requestDancerPhotosJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId }),
        fallbackMessage: "Unable to delete photo. Try again.",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      deleted = true;
      setDeletedPhotoIds((current) => new Set(current).add(photoId));
      onPhotoDeleted(photoId);
      setPhotoStatus("Photo deleted.");
      const data = await requestDancerProfileJson({
        cache: "no-store",
        fallbackMessage: "Unable to refresh your photos.",
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (!data.profile) throw new Error("Unable to refresh your photos.");
      const rows = [...(data.profile.dancer_photos || []), ...(data.profile.pending_photo_reviews || [])];
      if (rows.some((photo: { id?: string }) => photo.id === photoId)) throw new Error("Unable to verify the refreshed photos.");
      onPhotoDeleted(photoId, data.profile);
    } catch (error) {
      if (isCurrent()) setPhotoStatus(deleted
        ? "Photo deleted. Reload your profile to refresh the remaining photos."
        : error instanceof Error ? error.message : "Unable to delete photo. Try again.");
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
      setVideoStatus("Video deleted.");
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
    <section className="dancer-profile-media-uploads" aria-label="Add profile photos and videos">
      {(["photos", "videos"] as const).map((section) => {
        const isPhoto = section === "photos";
        const label = isPhoto ? "Photo" : "Video";
        const items = isPhoto ? photos.filter((photo) => !deletedPhotoIds.has(photo.id)) : videos.filter((video) => !deletedVideoIds.has(video.id));
        return (
          <div className="profile-upload-group" key={section}>
            <header>
              <strong>{isPhoto ? "Photos" : "Videos"}</strong>
              <small>{isPhoto ? "At least 1 solo photo" : "Optional"}</small>
              <span>{!isPhoto && isVideoLoading ? "Loading…" : !isPhoto && videoError ? "Unavailable" : `${items.length} added`}</span>
            </header>
            <p>{isPhoto ? "You can add more photos later." : "You can add videos now or later."}</p>
            <button className="profile-upload-entry" data-profile-editor-trigger={section} disabled={isDeleting} onClick={() => onOpen(section)} type="button">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                {isPhoto ? <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8" cy="9" r="1.5" /><path d="m5 17 4-4 3 3 3-4 4 5" /></> : <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></>}
              </svg>
              <span><strong>Add {label.toLowerCase()}</strong><small>Camera or phone files</small></span>
              <b aria-hidden="true">+</b>
            </button>
            {items.length ? (
              <ul className="profile-upload-items" aria-label={`Uploaded ${section}`}>
                {items.map((item, index) => (
                  <li key={item.id}>
                    <div className="profile-upload-preview">
                      <button aria-label={`Manage ${label.toLowerCase()} ${index + 1}: ${profileUploadStatus(item.status)}`} disabled={isDeleting} onClick={() => onOpen(section)} type="button">
                        <span className="profile-upload-thumbnail">
                          {isPhoto
                            ? item.imageUrl ? <img alt="" loading="lazy" src={item.imageUrl} /> : <span aria-hidden="true">▧</span>
                            : <DancerVideoThumbnail posterUrl={item.imageUrl} videoUrl={item.videoUrl} />}
                          {!isPhoto ? <i aria-hidden="true">▶</i> : null}
                        </span>
                      </button>
                      {onMediaPinned ? <DancerMediaPinButton available={item.status === "approved"} label={`${label.toLowerCase()} ${index + 1}`} pinned={item.isPinned} busy={pinningId === item.id} disabled={isDeleting} onClick={() => void pinPreview(isPhoto ? "photo" : "video", item)} /> : null}
                      <button
                        aria-label={`${(isPhoto ? deletingPhotoId : deletingVideoId) === item.id ? "Deleting" : "Delete"} ${label.toLowerCase()} ${index + 1}`}
                        aria-busy={(isPhoto ? deletingPhotoId : deletingVideoId) === item.id}
                        className="profile-upload-delete"
                        disabled={isDeleting}
                        onClick={() => void (isPhoto ? deletePreviewPhoto(item.id) : deletePreviewVideo(item.id))}
                        type="button"
                      >
                        <span className="profile-upload-delete-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
                        </span>
                      </button>
                    </div>
                    <strong>{label} {index + 1}</strong>
                    <small className={item.status === "approved" ? "is-ready" : ""}>{profileUploadStatus(item.status)}</small>
                  </li>
                ))}
              </ul>
            ) : null}
            {isPhoto && photoStatus ? <p role="status" aria-live="polite">{photoStatus}</p> : null}
            {!isPhoto && videoStatus ? <p role="status" aria-live="polite">{videoStatus}</p> : null}
            {!isPhoto && videoError ? <p role="status">{videoError} <button className="profile-upload-retry" onClick={() => onOpen("videos")} type="button">Open video manager to retry</button></p> : null}
          </div>
        );
      })}
      <p className="profile-upload-visibility" role="status" aria-live="polite">
        {isApproved
          ? isPublic ? "Approved uploads appear on your profile." : "Uploads stay saved. Turn off incognito to show approved media on your profile."
          : "Uploaded photos and videos will appear on your profile after review and completion of your profile setup."}
      </p>
      <style>{`
        .dancer-profile-media-uploads { width:min(100%,760px); min-width:0; display:grid; gap:16px; margin:12px auto 0; }
        .profile-upload-group { min-width:0; display:grid; gap:9px; }
        .profile-upload-group > header { display:flex; align-items:baseline; flex-wrap:wrap; gap:6px 10px; }
        .profile-upload-group > header strong { color:#fff; font-size:18px; line-height:1.3; }
        .profile-upload-group > header small { color:#bdb7c9; font-size:12px; }
        .profile-upload-group > header > span { margin-left:auto; color:#c9c3d2; font-size:12px; }
        .dancer-profile-media-uploads .profile-upload-entry { width:100%; min-width:0; min-height:78px; display:flex; align-items:center; gap:14px; padding:14px 16px; border:1px solid #645778; border-radius:16px; color:#fff; background:linear-gradient(120deg,#221333,#100d18); text-align:left; font:inherit; cursor:pointer; }
        .profile-upload-entry > svg { width:28px; height:28px; flex:0 0 28px; fill:none; stroke:#d5baff; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .profile-upload-entry > span { min-width:0; display:grid; gap:4px; }
        .profile-upload-entry strong { color:#fff; font-size:16px; line-height:1.2; }
        .profile-upload-entry small { color:#d4cedd !important; -webkit-text-fill-color:currentColor !important; font-size:12px; line-height:1.3; }
        .profile-upload-entry > b { margin-left:auto; color:#e4d5ff; font-size:26px; line-height:1; }
        .profile-upload-items { min-width:0; display:flex; gap:10px; overflow-x:auto; margin:0; padding:2px 0 8px; list-style:none; }
        .profile-upload-items > li { flex:0 0 112px; min-width:0; display:grid; align-content:start; gap:4px; }
        .profile-upload-preview { position:relative; min-width:0; }
        .dancer-profile-media-uploads .profile-upload-items button { width:100%; min-height:44px; display:grid; gap:4px; padding:0; border:0; border-radius:8px; background:transparent; color:#fff; text-align:left; font:inherit; cursor:pointer; }
        .profile-upload-thumbnail { position:relative; width:100%; height:auto; aspect-ratio:3 / 4; display:grid; place-items:center; overflow:hidden; border:1px solid #40384b; border-radius:8px; background:#15101d; color:#c9c3d2; }
        .profile-upload-thumbnail img { width:100%; height:100%; display:block; object-fit:cover; }
        .profile-upload-thumbnail i { position:absolute; inset:50% auto auto 50%; transform:translate(-50%,-50%); display:grid; place-items:center; width:32px; height:32px; border-radius:50%; background:#000b; color:#fff; font-size:14px; font-style:normal; }
        .profile-upload-items strong { font-size:12px; line-height:1.3; }
        .profile-upload-items small { color:#d4c3e9; font-size:11px; line-height:1.35; }
        .profile-upload-items small.is-ready { color:#8ce4b2; }
        .profile-upload-group > p { margin:0; color:#c9c3d2; font-size:12px; line-height:1.5; }
        .dancer-profile-media-uploads .profile-upload-visibility { box-sizing:border-box; width:100%; margin:4px 0 16px; padding:14px 12px 0; border-top:1px solid #d5baff20; color:#c9c3d2; font-size:12px; line-height:1.5; text-align:center; text-wrap:pretty; }
        .dancer-profile-media-uploads .profile-upload-retry { min-height:44px; padding:6px 0; border:0; background:transparent; color:#fff; font:inherit; text-decoration:underline; cursor:pointer; }
        .dancer-profile-media-uploads button:focus-visible { outline:2px solid #fff; outline-offset:3px; }
        body.dancr-button-system .dancer-profile-media-uploads .profile-upload-entry { min-height:78px !important; padding:14px 16px !important; border-radius:16px !important; background:linear-gradient(120deg,#221333,#100d18) !important; box-shadow:none !important; }
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
