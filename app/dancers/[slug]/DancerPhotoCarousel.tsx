"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  viewerStatus?: string;
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
  posterUrl: string | null;
  durationSeconds: number;
};

type ProfileMedia = PhotoMedia | VideoMedia;
type MediaTab = ProfileMedia["kind"];
type MediaViewer = { kind: MediaTab; index: number };

type SwipeGesture = {
  pointerId: number | null;
  startX: number;
  startY: number;
  vertical: boolean;
  cancelled: boolean;
};

const SWIPE_DISTANCE_PX = 44;
const TRACKPAD_LOCK_MS = 320;

export function DancerPhotoCarousel({
  photos,
  videos = [],
  stageName,
  viewerStatus = "No shift posted",
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
          posterUrl: video.posterUrl || null,
        })),
    [videos],
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
  const viewerRoot = useRef<HTMLDivElement | null>(null);
  const viewerOwnsFullscreen = useRef(false);
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
    const onFullscreenChange = () => {
      if (fullscreenElement() !== viewerRoot.current) {
        viewerOwnsFullscreen.current = false;
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

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
        exitViewerFullscreen();
        setViewer(null);
        setShareStatus("");
        clearMediaDeepLink();
        window.requestAnimationFrame(() => viewerTrigger.current?.focus());
        return;
      }
      const previousKey = "ArrowUp";
      const nextKey = "ArrowDown";
      if (event.key !== previousKey && event.key !== nextKey) return;
      event.preventDefault();
      const direction = event.key === nextKey ? 1 : -1;
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
    flushSync(() => setViewer({ kind, index }));
    void requestViewerFullscreen();
  }

  function closeViewer() {
    exitViewerFullscreen();
    setViewer(null);
    setShareStatus("");
    clearMediaDeepLink();
    window.requestAnimationFrame(() => viewerTrigger.current?.focus());
  }

  async function requestViewerFullscreen() {
    const element = viewerRoot.current as FullscreenViewerElement | null;
    if (!element || fullscreenElement()) return;
    const request = typeof element.requestFullscreen === "function"
      ? () => element.requestFullscreen({ navigationUI: "hide" })
      : typeof element.webkitRequestFullscreen === "function"
        ? () => element.webkitRequestFullscreen?.()
        : null;
    if (!request) return;
    try {
      await request();
      viewerOwnsFullscreen.current = fullscreenElement() === element;
    } catch {
      viewerOwnsFullscreen.current = false;
    }
  }

  function exitViewerFullscreen() {
    const documentWithWebkit = document as FullscreenViewerDocument;
    const exit = document.exitFullscreen || documentWithWebkit.webkitExitFullscreen;
    if (!viewerOwnsFullscreen.current || !fullscreenElement() || !exit) {
      viewerOwnsFullscreen.current = false;
      return;
    }
    viewerOwnsFullscreen.current = false;
    try {
      const result = exit.call(document);
      if (result && typeof result.catch === "function") void result.catch(() => undefined);
    } catch {
      // The fixed overlay remains available when device fullscreen has already exited.
    }
  }

  function viewerShareUrl(item: ProfileMedia) {
    if (item.kind === "video") {
      return new URL(`/tv/${encodeURIComponent(item.id)}`, window.location.origin).toString();
    }
    const url = new URL(window.location.href);
    url.searchParams.set("media", "photo");
    url.searchParams.set("mediaIndex", String(viewerIndex));
    return url.toString();
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
    if (!activeViewerItem) return;
    const url = viewerShareUrl(activeViewerItem);
    const isVideo = activeViewerItem.kind === "video";
    setShareStatus("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${stageName} on ${isVideo ? "MyDancr TV" : "MyDancr"}`,
          text: `${isVideo ? "Watch" : "View"} ${stageName} on ${isVideo ? "MyDancr TV" : "MyDancr"}.`,
          url,
        });
        setShareStatus(isVideo ? "Video shared." : "Photo shared.");
        return;
      }
      await copyViewerShareUrl(url);
      setShareStatus(isVideo ? "Video link copied." : "Photo link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus(isVideo ? "Unable to share this video." : "Unable to share this photo.");
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
      vertical: false,
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
    if (Math.abs(distanceX) >= Math.abs(distanceY)) {
      current.cancelled = true;
      return;
    }
    current.vertical = true;
    event.preventDefault();
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (current.pointerId !== event.pointerId) return;
    const distanceX = event.clientX - current.startX;
    const distanceY = event.clientY - current.startY;
    const mediaSwipe =
      current.vertical &&
      Math.abs(distanceY) >= SWIPE_DISTANCE_PX &&
      Math.abs(distanceY) > Math.abs(distanceX) * 1.2;
    if (!current.cancelled && mediaSwipe) {
      event.preventDefault();
      showRelativeViewerItem(distanceY < 0 ? 1 : -1);
    }
    resetGesture();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (viewerItems.length < 2) return;
    const primaryDelta = event.deltaY;
    const crossDelta = event.deltaX;
    if (Math.abs(primaryDelta) < 18 || Math.abs(primaryDelta) <= Math.abs(crossDelta)) return;
    event.preventDefault();
    const now = Date.now();
    if (now < trackpadLockedUntil.current) return;
    trackpadLockedUntil.current = now + TRACKPAD_LOCK_MS;
    showRelativeViewerItem(primaryDelta > 0 ? 1 : -1);
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
                <video
                  aria-hidden="true"
                  draggable={false}
                  muted
                  playsInline
                  poster={item.posterUrl || undefined}
                  preload="metadata"
                  src={`${item.videoUrl}#t=0.1`}
                  tabIndex={-1}
                />
                <span aria-hidden="true" className="profile-media-play" />
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
          ref={viewerRoot}
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
              ↑
            </button>
            <button
              aria-label={`Next ${viewer.kind}`}
              className="profile-media-viewer-next"
              disabled={viewerIndex >= viewerItems.length - 1}
              onClick={() => showRelativeViewerItem(1)}
              type="button"
            >
              ↓
            </button>
          </div>
          <div className="profile-media-viewer-footer">
            <div className="profile-media-viewer-copy">
              <strong>{stageName}</strong>
              <span>
                {viewerStatus} · Swipe up or down · {viewer.kind === "photo" ? "Photo" : "Video"} {viewerIndex + 1} of {viewerItems.length}
              </span>
            </div>
            <div className="profile-media-viewer-actions">
              <button
                aria-label={activeViewerItem.kind === "video" ? "Share this TV video" : "Share this profile photo"}
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

type FullscreenViewerDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenViewerElement = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenElement() {
  return document.fullscreenElement ||
    (document as FullscreenViewerDocument).webkitFullscreenElement ||
    null;
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
    vertical: false,
    cancelled: false,
  };
}
