"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

type DancerPhotoCarouselProps = {
  photos: Array<{
    id: string;
    imageUrl: string;
    imageSrcSet?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
  }>;
  videos?: Array<{
    id: string;
    videoUrl: string;
    durationSeconds: number;
  }>;
  stageName: string;
};

type PhotoMedia = {
  id: string;
  kind: "photo";
  imageUrl: string;
  imageSrcSet?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
};

type VideoMedia = {
  id: string;
  kind: "video";
  videoUrl: string;
  durationSeconds: number;
};

type ProfileMedia = PhotoMedia | VideoMedia;
type MediaTab = ProfileMedia["kind"];

type SwipeGesture = {
  pointerId: number | null;
  startX: number;
  startY: number;
  horizontal: boolean;
  cancelled: boolean;
};

const SWIPE_DISTANCE_PX = 44;
const TRACKPAD_LOCK_MS = 320;

export function DancerPhotoCarousel({
  photos,
  videos = [],
  stageName,
}: DancerPhotoCarouselProps) {
  const photoMedia = useMemo<PhotoMedia[]>(
    () =>
      photos
        .filter((photo) => photo.imageUrl)
        .map((photo) => ({ ...photo, kind: "photo" })),
    [photos],
  );
  const videoMedia = useMemo<VideoMedia[]>(
    () =>
      videos
        .filter((video) => video.videoUrl)
        .map((video) => ({ ...video, kind: "video" })),
    [videos],
  );
  const [activeTab, setActiveTab] = useState<MediaTab>(
    photoMedia.length ? "photo" : "video",
  );
  const [viewer, setViewer] = useState<{ kind: MediaTab; index: number } | null>(
    null,
  );
  const gesture = useRef<SwipeGesture>(emptyGesture());
  const trackpadLockedUntil = useRef(0);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const activeItems: ProfileMedia[] =
    activeTab === "photo" ? photoMedia : videoMedia;
  const viewerItems: ProfileMedia[] = viewer?.kind === "video"
    ? videoMedia
    : photoMedia;
  const viewerIndex = viewer
    ? Math.min(Math.max(viewer.index, 0), Math.max(0, viewerItems.length - 1))
    : 0;
  const activeViewerItem = viewerItems[viewerIndex];

  useEffect(() => {
    if (activeTab === "photo" && !photoMedia.length && videoMedia.length) {
      setActiveTab("video");
    }
    if (activeTab === "video" && !videoMedia.length && photoMedia.length) {
      setActiveTab("photo");
    }
  }, [activeTab, photoMedia.length, videoMedia.length]);

  useEffect(() => {
    if (!viewer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewer(null);
      if (event.key === "ArrowLeft") showRelativeViewerItem(-1);
      if (event.key === "ArrowRight") showRelativeViewerItem(1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  function openViewer(kind: MediaTab, index: number) {
    setViewer({ kind, index });
  }

  function showRelativeViewerItem(direction: -1 | 1) {
    setViewer((current) => {
      if (!current) return current;
      const items = current.kind === "photo" ? photoMedia : videoMedia;
      const nextIndex = current.index + direction;
      if (nextIndex < 0 || nextIndex >= items.length) return current;
      return { ...current, index: nextIndex };
    });
  }

  function resetGesture() {
    gesture.current = emptyGesture();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      (event.target as HTMLElement).closest("button")
    ) {
      return;
    }
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
      cancelled: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (current.pointerId !== event.pointerId || current.cancelled) return;
    const distanceX = event.clientX - current.startX;
    const distanceY = event.clientY - current.startY;
    if (Math.abs(distanceX) < 10 && Math.abs(distanceY) < 10) return;
    if (Math.abs(distanceY) >= Math.abs(distanceX)) {
      current.cancelled = true;
      return;
    }
    current.horizontal = true;
    event.preventDefault();
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (current.pointerId !== event.pointerId) return;
    const distanceX = event.clientX - current.startX;
    const distanceY = event.clientY - current.startY;
    if (
      !current.cancelled &&
      current.horizontal &&
      Math.abs(distanceX) >= SWIPE_DISTANCE_PX &&
      Math.abs(distanceX) > Math.abs(distanceY) * 1.2
    ) {
      event.preventDefault();
      showRelativeViewerItem(distanceX < 0 ? 1 : -1);
    }
    resetGesture();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (
      viewerItems.length < 2 ||
      Math.abs(event.deltaX) < 18 ||
      Math.abs(event.deltaX) <= Math.abs(event.deltaY)
    ) {
      return;
    }
    event.preventDefault();
    const now = Date.now();
    if (now < trackpadLockedUntil.current) return;
    trackpadLockedUntil.current = now + TRACKPAD_LOCK_MS;
    showRelativeViewerItem(event.deltaX > 0 ? 1 : -1);
  }

  return (
    <section
      aria-label={`${stageName} approved profile media`}
      className="profile-media-section"
      data-dancer-media-tabs
    >
      <div className="profile-media-heading">
        <div>
          <span className="eyebrow">Media</span>
          <h2>{stageName}</h2>
        </div>
        <span>{photoMedia.length + videoMedia.length} approved</span>
      </div>
      <div
        aria-label={`${stageName} media type`}
        className="profile-media-tabs"
        role="tablist"
      >
        <button
          aria-controls="dancer-profile-media-grid"
          aria-selected={activeTab === "photo"}
          className={activeTab === "photo" ? "active" : ""}
          disabled={!photoMedia.length}
          onClick={() => setActiveTab("photo")}
          role="tab"
          type="button"
        >
          Photos <span>{photoMedia.length}</span>
        </button>
        <button
          aria-controls="dancer-profile-media-grid"
          aria-selected={activeTab === "video"}
          className={activeTab === "video" ? "active" : ""}
          disabled={!videoMedia.length}
          onClick={() => setActiveTab("video")}
          role="tab"
          type="button"
        >
          TV <span>{videoMedia.length}</span>
        </button>
      </div>
      <div
        aria-label={`${stageName} ${activeTab === "photo" ? "photos" : "MyDancr TV videos"}`}
        className="profile-media-grid"
        id="dancer-profile-media-grid"
        role="tabpanel"
      >
        {activeItems.map((item, index) => (
          <button
            aria-label={`Open ${stageName} ${item.kind} ${index + 1} of ${activeItems.length} full screen`}
            className={`profile-media-grid-item is-${item.kind}`}
            key={`${item.kind}-${item.id}`}
            onClick={() => openViewer(item.kind, index)}
            type="button"
          >
            {item.kind === "photo" ? (
              <img
                alt=""
                aria-hidden="true"
                decoding="async"
                draggable={false}
                height={item.imageHeight || undefined}
                sizes="(max-width: 760px) 33vw, 250px"
                src={item.imageUrl}
                srcSet={item.imageSrcSet || undefined}
                width={item.imageWidth || undefined}
              />
            ) : (
              <>
                <video
                  aria-hidden="true"
                  muted
                  playsInline
                  preload="metadata"
                  src={item.videoUrl}
                  tabIndex={-1}
                />
                <span aria-hidden="true" className="profile-media-play" />
                <span className="profile-media-duration">
                  {formatDuration(item.durationSeconds)}
                </span>
              </>
            )}
          </button>
        ))}
        {!activeItems.length ? (
          <p className="profile-media-empty">
            No approved {activeTab === "photo" ? "photos" : "TV videos"} yet.
          </p>
        ) : null}
      </div>
      {viewer && activeViewerItem ? (
        <div
          aria-label={`${stageName} ${viewer.kind === "photo" ? "photo" : "TV video"} viewer`}
          aria-modal="true"
          className="profile-media-viewer"
          role="dialog"
        >
          <button
            aria-label="Close full-screen profile media"
            className="profile-media-viewer-close"
            onClick={() => setViewer(null)}
            ref={closeButton}
            type="button"
          >
            ×
          </button>
          <div
            className="profile-media-viewer-stage"
            data-profile-media-swipe-surface
            onPointerCancel={resetGesture}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onWheel={handleWheel}
          >
            {activeViewerItem.kind === "photo" ? (
              <img
                alt={`${stageName} photo ${viewerIndex + 1} of ${viewerItems.length}`}
                decoding="async"
                draggable={false}
                height={activeViewerItem.imageHeight || undefined}
                sizes="100vw"
                src={activeViewerItem.imageUrl}
                srcSet={activeViewerItem.imageSrcSet || undefined}
                width={activeViewerItem.imageWidth || undefined}
              />
            ) : (
              <video
                aria-label={`${stageName} TV video ${viewerIndex + 1} of ${viewerItems.length}`}
                autoPlay
                controls
                controlsList="nofullscreen noremoteplayback nodownload"
                disablePictureInPicture
                key={activeViewerItem.id}
                loop
                playsInline
                preload="auto"
                src={activeViewerItem.videoUrl}
              />
            )}
            <button
              aria-label={`Previous ${viewer.kind === "photo" ? "photo" : "TV video"}`}
              className="profile-media-viewer-previous"
              disabled={viewerIndex <= 0}
              onClick={() => showRelativeViewerItem(-1)}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label={`Next ${viewer.kind === "photo" ? "photo" : "TV video"}`}
              className="profile-media-viewer-next"
              disabled={viewerIndex >= viewerItems.length - 1}
              onClick={() => showRelativeViewerItem(1)}
              type="button"
            >
              ›
            </button>
          </div>
          <div className="profile-media-viewer-footer">
            <strong>{stageName}</strong>
            <span>
              {viewer.kind === "photo" ? "Photo" : "TV"} {viewerIndex + 1} of{" "}
              {viewerItems.length}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function emptyGesture(): SwipeGesture {
  return {
    pointerId: null,
    startX: 0,
    startY: 0,
    horizontal: false,
    cancelled: false,
  };
}

function formatDuration(durationSeconds: number) {
  const seconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
