"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useVideoSoundPreference } from "@/src/lib/dancr/use-video-sound-preference";
import { DANCER_PROFILE_MEDIA_PAGE_SIZE } from "@/src/lib/dancr/media-limits";

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
    posterUrl?: string | null;
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
  posterUrl: string;
  durationSeconds: number;
};

type ProfileMedia = PhotoMedia | VideoMedia;
type MediaTab = ProfileMedia["kind"];
type MediaViewer = { kind: MediaTab; index: number };

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
        .map((video) => ({
          ...video,
          kind: "video",
          posterUrl: video.posterUrl || photoMedia[0]?.imageUrl || "",
        })),
    [photoMedia, videos],
  );
  const [activeTab, setActiveTab] = useState<MediaTab>(
    photoMedia.length || !videoMedia.length ? "photo" : "video",
  );
  const [viewer, setViewer] = useState<MediaViewer | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<MediaTab, number>>({
    photo: DANCER_PROFILE_MEDIA_PAGE_SIZE,
    video: DANCER_PROFILE_MEDIA_PAGE_SIZE,
  });
  const [inlineMuted, setInlineMuted] = useVideoSoundPreference();
  const [shareStatus, setShareStatus] = useState("");
  const gesture = useRef<SwipeGesture>(emptyGesture());
  const trackpadLockedUntil = useRef(0);
  const deepLinkHandled = useRef(false);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const viewerTrigger = useRef<HTMLButtonElement | null>(null);
  const lazyLoadSentinel = useRef<HTMLDivElement | null>(null);
  const tabGroupId = useId();
  const activeItems: ProfileMedia[] =
    activeTab === "photo" ? photoMedia : videoMedia;
  const visibleItemCount = Math.min(visibleCounts[activeTab], activeItems.length);
  const visibleItems = activeItems.slice(0, visibleItemCount);
  const hasMoreItems = visibleItemCount < activeItems.length;
  const viewerItems: ProfileMedia[] = viewer?.kind === "photo"
    ? photoMedia
    : viewer?.kind === "video"
      ? videoMedia
      : [];
  const viewerIndex = viewer
    ? Math.min(Math.max(viewer.index, 0), Math.max(0, viewerItems.length - 1))
    : 0;
  const activeViewerItem = viewerItems[viewerIndex];
  const adjacentViewerItems = viewer
    ? [viewerItems[viewerIndex - 1], viewerItems[viewerIndex + 1]].filter(
        (item): item is ProfileMedia => Boolean(item),
      )
    : [];
  const viewerKind = viewer?.kind;
  const activeTabId = `${tabGroupId}-${activeTab}-tab`;
  const panelId = `${tabGroupId}-panel`;

  useEffect(() => {
    if (deepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const requestedKind = params.get("media");
    if (requestedKind !== "photo" && requestedKind !== "video") {
      deepLinkHandled.current = true;
      return;
    }
    const requestedItems = requestedKind === "photo" ? photoMedia : videoMedia;
    if (!requestedItems.length) return;
    const requestedIndex = Number(params.get("mediaIndex"));
    const index = Number.isInteger(requestedIndex)
      ? Math.min(Math.max(requestedIndex, 0), requestedItems.length - 1)
      : 0;
    deepLinkHandled.current = true;
    setActiveTab(requestedKind);
    setViewer({ kind: requestedKind, index });
  }, [photoMedia, videoMedia]);

  useEffect(() => {
    if (activeTab === "photo" && !photoMedia.length && videoMedia.length) {
      setActiveTab("video");
    }
    if (activeTab === "video" && !videoMedia.length && photoMedia.length) {
      setActiveTab("photo");
    }
  }, [activeTab, photoMedia.length, videoMedia.length]);

  useEffect(() => {
    const sentinel = lazyLoadSentinel.current;
    if (!sentinel || !hasMoreItems) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCounts((current) => ({
          ...current,
          [activeTab]: Math.min(
            activeItems.length,
            current[activeTab] + DANCER_PROFILE_MEDIA_PAGE_SIZE,
          ),
        }));
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeItems.length, activeTab, hasMoreItems, visibleItemCount]);

  useEffect(() => {
    if (!viewerKind) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButton.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [viewerKind]);

  useEffect(() => {
    if (!viewerKind) return;
    const itemCount = viewerKind === "photo" ? photoMedia.length : videoMedia.length;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewer(null);
        setShareStatus("");
        clearMediaDeepLink();
        window.requestAnimationFrame(() => viewerTrigger.current?.focus());
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      setShareStatus("");
      setViewer((current) => {
        if (!current) return current;
        const nextIndex = current.index + direction;
        if (nextIndex < 0 || nextIndex >= itemCount) return current;
        return { ...current, index: nextIndex };
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [photoMedia.length, videoMedia.length, viewerKind]);

  function openViewer(
    kind: MediaTab,
    index: number,
    trigger: HTMLButtonElement,
  ) {
    viewerTrigger.current = trigger;
    setShareStatus("");
    setViewer({ kind, index });
  }

  function closeViewer() {
    setViewer(null);
    setShareStatus("");
    clearMediaDeepLink();
    window.requestAnimationFrame(() => viewerTrigger.current?.focus());
  }

  function viewerShareUrl(item: VideoMedia) {
    return new URL(`/tv/${encodeURIComponent(item.id)}`, window.location.origin).toString();
  }

  async function copyViewerShareUrl(url: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Unable to copy media link");
  }

  async function shareViewerItem() {
    if (!activeViewerItem || activeViewerItem.kind !== "video") return;
    const url = viewerShareUrl(activeViewerItem);
    setShareStatus("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${stageName} on MyDancr TV`,
          text: `Watch ${stageName} on MyDancr TV.`,
          url,
        });
        setShareStatus("Video shared.");
        return;
      }
      await copyViewerShareUrl(url);
      setShareStatus("Video link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus("Unable to share this video.");
    }
  }

  function showRelativeViewerItem(direction: -1 | 1) {
    setShareStatus("");
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
      <div
        aria-label={`${stageName} media type`}
        className="profile-media-tabs"
        role="tablist"
      >
        <button
          aria-controls={panelId}
          aria-label={`Photos, ${photoMedia.length}`}
          aria-selected={activeTab === "photo"}
          className={activeTab === "photo" ? "active" : ""}
          disabled={!photoMedia.length}
          id={`${tabGroupId}-photo-tab`}
          onClick={() => setActiveTab("photo")}
          role="tab"
          type="button"
        >
          <svg aria-hidden="true" className="profile-media-tab-icon" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="8.5" cy="9" r="1.5" />
            <path d="m5 17 4.5-4.5 3.2 3.2 2.2-2.2L19 17" />
          </svg>
          <span className="profile-media-tab-label">Photos</span>
          <span aria-hidden="true" className="profile-media-tab-count">
            {photoMedia.length}
          </span>
        </button>
        <button
          aria-controls={panelId}
          aria-label={`Videos, ${videoMedia.length}`}
          aria-selected={activeTab === "video"}
          className={activeTab === "video" ? "active" : ""}
          disabled={!videoMedia.length}
          id={`${tabGroupId}-video-tab`}
          onClick={() => setActiveTab("video")}
          role="tab"
          type="button"
        >
          <svg aria-hidden="true" className="profile-media-tab-icon" viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path className="profile-media-tab-play" d="m10 9 5 3-5 3Z" />
          </svg>
          <span className="profile-media-tab-label">Videos</span>
          <span aria-hidden="true" className="profile-media-tab-count">
            {videoMedia.length}
          </span>
        </button>
      </div>
      <div
        aria-label={`${stageName} ${activeTab === "photo" ? "photos" : "videos"}`}
        aria-labelledby={activeTabId}
        className="profile-media-grid"
        id={panelId}
        role="tabpanel"
      >
        {visibleItems.map((item, index) => (
          <button
            aria-label={`Open ${stageName} ${item.kind} ${index + 1} of ${activeItems.length}`}
            className={`profile-media-grid-item is-${item.kind}`}
            key={`${item.kind}-${item.id}`}
            onClick={(event) => openViewer(item.kind, index, event.currentTarget)}
            type="button"
          >
            {item.kind === "photo" ? (
              <img
                alt=""
                aria-hidden="true"
                decoding="async"
                draggable={false}
                height={item.imageHeight || undefined}
                loading="lazy"
                sizes="(max-width: 760px) 33vw, 250px"
                src={item.imageUrl}
                srcSet={item.imageSrcSet || undefined}
                width={item.imageWidth || undefined}
              />
            ) : (
              <>
                {item.posterUrl ? (
                  <img
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    draggable={false}
                    loading="lazy"
                    sizes="(max-width: 760px) 33vw, 250px"
                    src={item.posterUrl}
                  />
                ) : (
                  <span aria-hidden="true" className="profile-media-poster-placeholder" />
                )}
                <span aria-hidden="true" className="profile-media-play" />
                <span className="profile-media-duration">
                  {formatDuration(item.durationSeconds)}
                </span>
              </>
            )}
          </button>
        ))}
        {hasMoreItems ? (
          <div
            aria-hidden="true"
            className="profile-media-grid-sentinel"
            data-profile-media-lazy-sentinel
            ref={lazyLoadSentinel}
          />
        ) : null}
        {activeItems.length ? (
          <span aria-live="polite" className="profile-media-grid-status">
            Showing {visibleItemCount} of {activeItems.length} {activeTab === "photo" ? "photos" : "videos"}
          </span>
        ) : null}
        {!activeItems.length ? (
          <p className="profile-media-empty">
            No approved {activeTab === "photo" ? "photos" : "videos"} yet.
          </p>
        ) : null}
      </div>
      {viewer && activeViewerItem ? (
        <div
          aria-label={`${stageName} ${viewer.kind} viewer`}
          aria-modal="true"
          className={`profile-media-viewer is-${viewer.kind}`}
          role="dialog"
        >
          <button
            aria-label="Close full-screen profile media"
            className="profile-media-viewer-close"
            onClick={closeViewer}
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
                key={activeViewerItem.id}
                sizes="100vw"
                src={activeViewerItem.imageUrl}
                srcSet={activeViewerItem.imageSrcSet || undefined}
                width={activeViewerItem.imageWidth || undefined}
              />
            ) : (
              <video
                aria-label={`${stageName} video ${viewerIndex + 1} of ${viewerItems.length}`}
                autoPlay
                controls
                controlsList="nofullscreen noremoteplayback nodownload"
                disablePictureInPicture
                key={activeViewerItem.id}
                loop
                muted={inlineMuted}
                onVolumeChange={(event) => {
                  if (event.currentTarget.muted !== inlineMuted) {
                    setInlineMuted(event.currentTarget.muted);
                  }
                }}
                playsInline
                preload="auto"
                src={activeViewerItem.videoUrl}
              />
            )}
            <button
              aria-label={`Previous ${viewer.kind}`}
              className="profile-media-viewer-previous"
              disabled={viewerIndex <= 0}
              onClick={() => showRelativeViewerItem(-1)}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label={`Next ${viewer.kind}`}
              className="profile-media-viewer-next"
              disabled={viewerIndex >= viewerItems.length - 1}
              onClick={() => showRelativeViewerItem(1)}
              type="button"
            >
              ›
            </button>
          </div>
          <div className="profile-media-viewer-footer">
            <div className="profile-media-viewer-copy">
              <strong>{stageName}</strong>
              <span>
                {viewer.kind === "photo" ? "Photo" : "Video"} {viewerIndex + 1} of {viewerItems.length}
              </span>
            </div>
            {activeViewerItem.kind === "video" ? (
              <div className="profile-media-viewer-actions">
                <button
                  aria-label="Share this TV video"
                  className="profile-media-viewer-share"
                  onClick={shareViewerItem}
                  type="button"
                >
                  <ShareIcon />
                  Share
                </button>
                <span aria-live="polite" className="profile-media-viewer-share-status">
                  {shareStatus}
                </span>
              </div>
            ) : (
              <span className="profile-media-viewer-hint">Swipe to browse photos</span>
            )}
          </div>
          {adjacentViewerItems.length ? (
            <div aria-hidden="true" className="profile-media-viewer-preload">
              {adjacentViewerItems.map((item) =>
                item.kind === "photo" ? (
                  <img alt="" key={`preload-photo-${item.id}`} src={item.imageUrl} />
                ) : (
                  <video
                    key={`preload-video-${item.id}`}
                    muted
                    playsInline
                    preload="metadata"
                    src={item.videoUrl}
                  />
                ),
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </svg>
  );
}

function clearMediaDeepLink() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("media") && !url.searchParams.has("mediaIndex")) return;
  url.searchParams.delete("media");
  url.searchParams.delete("mediaIndex");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
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
