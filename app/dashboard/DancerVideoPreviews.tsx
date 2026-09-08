"use client";

import { useEffect, useRef, useState } from "react";
import DancerVideoThumbnail from "./DancerVideoThumbnail";

type PreviewVideo = {
  id: string;
  videoUrl: string;
  posterUrl?: string | null;
  status: string;
};

export function videoPreviewStatus(status: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not approved";
  if (["pending", "moderating", "submitted", "review"].includes(status)) return "Checking";
  if (status === "uploading") return "Upload incomplete";
  if (status === "failed") return "Upload failed";
  return "Unavailable";
}

export default function DancerVideoPreviews({ videos, removingId, disabled, onRemove }: {
  videos: PreviewVideo[];
  removingId: string;
  disabled: boolean;
  onRemove: (videoId: string) => void;
}) {
  const [activeId, setActiveId] = useState("");
  const [playbackError, setPlaybackError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeVideo = videos.find((video) => video.id === activeId);
  const activeVideoId = activeVideo?.id;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!activeVideoId || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [activeVideoId]);

  return (
    <div className="dancer-video-previews">
      <ul className="video-preview-list" aria-label="Uploaded videos">
        {videos.map((video, index) => (
          <li key={video.id}>
            <div className="video-preview-frame">
              <button
                className="video-preview-open"
                aria-label={`Play video ${index + 1}: ${videoPreviewStatus(video.status)}`}
                disabled={disabled || !video.videoUrl}
                onClick={() => { setPlaybackError(false); setActiveId(video.id); }}
                type="button"
              >
                <DancerVideoThumbnail posterUrl={video.posterUrl} videoUrl={video.videoUrl} />
                <span className="video-preview-play" aria-hidden="true">▶</span>
              </button>
              <button
                className="video-preview-delete"
                aria-label={`${removingId === video.id ? "Deleting" : "Delete"} video ${index + 1}`}
                aria-busy={removingId === video.id}
                disabled={disabled}
                onClick={() => onRemove(video.id)}
                type="button"
              >
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg></span>
              </button>
            </div>
            <strong>Video {index + 1}</strong>
            <small className={video.status === "approved" ? "is-ready" : ""}>{videoPreviewStatus(video.status)}</small>
          </li>
        ))}
      </ul>
      <dialog
        className="video-preview-player"
        ref={dialogRef}
        aria-label="Video preview"
        onCancel={(event) => { event.preventDefault(); setActiveId(""); }}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { if (event.target === event.currentTarget) setActiveId(""); }}
      >
        <div>
          <button aria-label="Close video preview" onClick={() => setActiveId("")} type="button">Close</button>
          {activeVideo ? <video key={activeVideo.id} autoPlay controls playsInline poster={activeVideo.posterUrl || undefined} src={activeVideo.videoUrl} onError={() => setPlaybackError(true)} /> : null}
          {playbackError ? <p role="status">Unable to play video. Close and try again.</p> : null}
        </div>
      </dialog>
      <style>{`
        .dancer-video-previews { min-width:0; width:100%; }
        .video-preview-list { min-width:0; display:flex; gap:10px; overflow-x:auto; margin:0; padding:2px 0 8px; list-style:none; }
        .video-preview-list > li { flex:0 0 112px; min-width:0; display:grid; align-content:start; gap:4px; }
        .video-preview-frame { position:relative; width:112px; aspect-ratio:3 / 4; }
        .dancer-video-previews .video-preview-open, body.dancr-button-system .dancer-video-previews .video-preview-open { position:relative; width:100%; height:100%; min-height:0; display:grid; place-items:center; overflow:hidden; margin:0; padding:0 !important; border:1px solid #40384b !important; border-radius:8px !important; background:#15101d !important; box-shadow:none !important; color:#fff; cursor:pointer; }
        .video-preview-open img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
        .video-preview-play { z-index:1; display:grid; place-items:center; width:32px; height:32px; border-radius:50%; background:#000b; color:#fff; font-size:14px; }
        .dancer-video-previews .video-preview-delete, body.dancr-button-system .dancer-video-previews .video-preview-delete { position:absolute; right:2px; bottom:2px; z-index:2; display:grid; place-items:center; width:44px !important; height:44px !important; min-height:44px; margin:0; padding:0 !important; border:0 !important; background:transparent !important; box-shadow:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; color:#fff !important; cursor:pointer; }
        .video-preview-delete > span { width:30px; height:30px; display:grid; place-items:center; justify-self:end; border:1px solid rgba(255,255,255,.4); border-radius:50%; background:rgba(0,0,0,.78); box-shadow:0 1px 5px rgba(0,0,0,.35); }
        .video-preview-delete svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .video-preview-list strong { color:#fff; font-size:12px; line-height:1.3; }
        .video-preview-list small { color:#d4c3e9; font-size:11px; line-height:1.35; }
        .video-preview-list small.is-ready { color:#8ce4b2; }
        .dancer-video-previews button:disabled { opacity:.55; cursor:wait; }
        .dancer-video-previews button:focus-visible { outline:2px solid #fff; outline-offset:3px; }
        dialog.video-preview-player { width:min(440px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); margin:auto; padding:12px; border:1px solid #645778; border-radius:16px; background:#100d18; color:#fff; }
        .video-preview-player::backdrop { background:rgba(0,0,0,.85); }
        .video-preview-player > div { display:grid; gap:10px; }
        .video-preview-player button { justify-self:end; min-width:64px; min-height:44px; }
        .video-preview-player video { display:block; width:100%; max-height:calc(100dvh - 140px); object-fit:contain; background:#000; }
        .video-preview-player p { margin:0; color:#fff; font-size:13px; }
      `}</style>
    </div>
  );
}
