"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
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
const INLINE_CONTROLS_HIDE_DELAY_MS = 1_500;

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
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewer, setViewer] = useState<{ index: number } | null>(null);
  const [inlineMuted, setInlineMuted] = useState(true);
  const [inlinePlaying, setInlinePlaying] = useState(false);
  const [inlineCurrentTime, setInlineCurrentTime] = useState(0);
  const [inlineDuration, setInlineDuration] = useState(0);
  const [inlineControlsVisible, setInlineControlsVisible] = useState(true);
  const [inlineControlsActivity, setInlineControlsActivity] = useState(0);
  const [shareStatus, setShareStatus] = useState("");
  const inlineGesture = useRef<SwipeGesture>(emptyGesture());
  const gesture = useRef<SwipeGesture>(emptyGesture());
  const inlineTrackpadLockedUntil = useRef(0);
  const trackpadLockedUntil = useRef(0);
  const inlineUserPaused = useRef(false);
  const deepLinkHandled = useRef(false);
  const inlineVideo = useRef<HTMLVideoElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const activeItems: ProfileMedia[] =
    activeTab === "photo" ? photoMedia : videoMedia;
  const selectedIndex = Math.min(
    Math.max(activeIndex, 0),
    Math.max(0, activeItems.length - 1),
  );
  const selectedItem = activeItems[selectedIndex];
  const selectedVideoDuration =
    selectedItem?.kind === "video" ? selectedItem.durationSeconds : 0;
  const inlineProgressDuration = inlineDuration || selectedVideoDuration;
  const inlineProgressPercent = inlineProgressDuration > 0
    ? Math.min(100, Math.max(0, (inlineCurrentTime / inlineProgressDuration) * 100))
    : 0;
  const viewerItems = videoMedia;
  const viewerIndex = viewer
    ? Math.min(Math.max(viewer.index, 0), Math.max(0, viewerItems.length - 1))
    : 0;
  const activeViewerItem = viewerItems[viewerIndex];

  useEffect(() => {
    if (deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("media") !== "photo" || !photoMedia.length) return;
    const requestedIndex = Number(params.get("mediaIndex"));
    const index = Number.isInteger(requestedIndex)
      ? Math.min(Math.max(requestedIndex, 0), photoMedia.length - 1)
      : 0;
    setActiveTab("photo");
    setActiveIndex(index);
  }, [photoMedia.length]);

  useEffect(() => {
    if (activeTab === "photo" && !photoMedia.length && videoMedia.length) {
      setActiveTab("video");
    }
    if (activeTab === "video" && !videoMedia.length && photoMedia.length) {
      setActiveTab("photo");
    }
  }, [activeTab, photoMedia.length, videoMedia.length]);

  useEffect(() => {
    setActiveIndex(0);
  }, [activeTab]);

  useEffect(() => {
    if (activeIndex >= activeItems.length && activeItems.length) {
      setActiveIndex(activeItems.length - 1);
    }
  }, [activeIndex, activeItems.length]);

  useEffect(() => {
    inlineUserPaused.current = false;
    setInlinePlaying(false);
    setInlineCurrentTime(0);
    setInlineDuration(selectedVideoDuration);
    setInlineControlsVisible(true);
  }, [selectedItem?.id, selectedItem?.kind, selectedVideoDuration]);

  useEffect(() => {
    if (selectedItem?.kind !== "video" || !inlinePlaying) {
      setInlineControlsVisible(true);
      return;
    }
    const timer = window.setTimeout(
      () => setInlineControlsVisible(false),
      INLINE_CONTROLS_HIDE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [inlineControlsActivity, inlinePlaying, selectedItem?.id, selectedItem?.kind]);

  useEffect(() => {
    const video = inlineVideo.current;
    if (!video || selectedItem?.kind !== "video") return;
    video.muted = inlineMuted;
    video.defaultMuted = true;
    const playWhenVisible = (visible: boolean) => {
      if (visible && !inlineUserPaused.current) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    if (!("IntersectionObserver" in window)) {
      playWhenVisible(true);
      return () => video.pause();
    }
    const observer = new IntersectionObserver(
      ([entry]) => playWhenVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.6)),
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [inlineMuted, selectedItem]);

  useEffect(() => {
    if (!viewer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft") showRelativeViewerItem(-1);
      if (event.key === "ArrowRight") showRelativeViewerItem(1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  function openViewer(index: number) {
    setShareStatus("");
    setViewer({ index });
  }

  function closeViewer() {
    setViewer(null);
    setShareStatus("");
    const url = new URL(window.location.href);
    if (!url.searchParams.has("media") && !url.searchParams.has("mediaIndex")) {
      return;
    }
    url.searchParams.delete("media");
    url.searchParams.delete("mediaIndex");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
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
    if (!activeViewerItem) return;
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

  function toggleInlinePlayback() {
    const video = inlineVideo.current;
    if (!video) return;
    revealInlineControls();
    if (video.paused) {
      inlineUserPaused.current = false;
      void video.play().catch(() => setInlinePlaying(false));
      return;
    }
    inlineUserPaused.current = true;
    video.pause();
  }

  function toggleInlineSound() {
    const video = inlineVideo.current;
    if (!video) return;
    revealInlineControls();
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setInlineMuted(nextMuted);
  }

  function seekInlineVideo(value: number) {
    const video = inlineVideo.current;
    if (!video || !Number.isFinite(value)) return;
    revealInlineControls();
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : inlineDuration;
    const nextTime = Math.min(Math.max(0, value), Math.max(0, duration));
    video.currentTime = nextTime;
    setInlineCurrentTime(nextTime);
  }

  function revealInlineControls() {
    setInlineControlsVisible(true);
    setInlineControlsActivity((activity) => activity + 1);
  }

  function showRelativeInlineItem(direction: -1 | 1) {
    setActiveIndex((current) => {
      const nextIndex = current + direction;
      if (nextIndex < 0 || nextIndex >= activeItems.length) return current;
      return nextIndex;
    });
  }

  function resetInlineGesture() {
    inlineGesture.current = emptyGesture();
  }

  function handleInlinePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      (event.target as HTMLElement).closest("button")
    ) {
      return;
    }
    if (selectedItem?.kind === "video") revealInlineControls();
    inlineGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
      cancelled: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleInlinePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = inlineGesture.current;
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

  function handleInlinePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const current = inlineGesture.current;
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
      showRelativeInlineItem(distanceX < 0 ? 1 : -1);
    }
    resetInlineGesture();
  }

  function handleInlineWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (
      activeItems.length < 2 ||
      Math.abs(event.deltaX) < 18 ||
      Math.abs(event.deltaX) <= Math.abs(event.deltaY)
    ) {
      return;
    }
    event.preventDefault();
    const now = Date.now();
    if (now < inlineTrackpadLockedUntil.current) return;
    inlineTrackpadLockedUntil.current = now + TRACKPAD_LOCK_MS;
    showRelativeInlineItem(event.deltaX > 0 ? 1 : -1);
  }

  function showRelativeViewerItem(direction: -1 | 1) {
    setShareStatus("");
    setViewer((current) => {
      if (!current) return current;
      const nextIndex = current.index + direction;
      if (nextIndex < 0 || nextIndex >= videoMedia.length) return current;
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
          aria-label={`Photos, ${photoMedia.length}`}
          aria-controls="dancer-profile-media-grid"
          aria-selected={activeTab === "photo"}
          className={activeTab === "photo" ? "active" : ""}
          disabled={!photoMedia.length}
          onClick={() => setActiveTab("photo")}
          role="tab"
          title="Photos"
          type="button"
        >
          <svg aria-hidden="true" className="profile-media-tab-icon" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="8.5" cy="9" r="1.5" />
            <path d="m5 17 4.5-4.5 3.2 3.2 2.2-2.2L19 17" />
          </svg>
        </button>
        <button
          aria-label={`TV videos, ${videoMedia.length}`}
          aria-controls="dancer-profile-media-grid"
          aria-selected={activeTab === "video"}
          className={activeTab === "video" ? "active" : ""}
          disabled={!videoMedia.length}
          onClick={() => setActiveTab("video")}
          role="tab"
          title="TV"
          type="button"
        >
          <svg aria-hidden="true" className="profile-media-tab-icon" viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path className="profile-media-tab-play" d="m10 9 5 3-5 3Z" />
          </svg>
        </button>
      </div>
      {selectedItem ? (
        <div
          aria-label={`${stageName} ${selectedItem.kind} ${selectedIndex + 1} of ${activeItems.length}. ${selectedItem.kind === "video" ? "Open full screen or swipe to change media." : "Swipe to change photos."}`}
          className={`profile-media-feature is-${selectedItem.kind}${selectedItem.kind === "video" && (inlineControlsVisible || !inlinePlaying) ? " is-controls-visible" : ""}`}
          data-profile-inline-media-swipe-surface
          onClick={(event) => {
            if (
              (event.target as HTMLElement).closest(
                "button, input, [data-profile-media-control]",
              )
            ) return;
            if (selectedItem.kind === "video") revealInlineControls();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              showRelativeInlineItem(event.key === "ArrowRight" ? 1 : -1);
            }
            if (selectedItem.kind === "video" && (event.key === " " || event.key === "Enter")) {
              event.preventDefault();
              toggleInlinePlayback();
            }
          }}
          onPointerCancel={resetInlineGesture}
          onPointerDown={handleInlinePointerDown}
          onPointerMove={handleInlinePointerMove}
          onPointerUp={handleInlinePointerEnd}
          onWheel={handleInlineWheel}
          role="group"
          style={selectedItem.kind === "photo" && selectedItem.imageWidth && selectedItem.imageHeight
            ? { aspectRatio: `${selectedItem.imageWidth} / ${selectedItem.imageHeight}` }
            : undefined}
          tabIndex={0}
        >
          {selectedItem.kind === "photo" ? (
            <img
              alt={`${stageName} photo ${selectedIndex + 1} of ${activeItems.length}`}
              decoding="async"
              draggable={false}
              height={selectedItem.imageHeight || undefined}
              sizes="(max-width: 760px) calc(100vw - 24px), 760px"
              src={selectedItem.imageUrl}
              srcSet={selectedItem.imageSrcSet || undefined}
              width={selectedItem.imageWidth || undefined}
            />
          ) : (
            <video
              aria-label={`${stageName} TV preview ${selectedIndex + 1} of ${activeItems.length}`}
              key={selectedItem.id}
              loop
              muted
              onDurationChange={(event) => {
                if (Number.isFinite(event.currentTarget.duration)) {
                  setInlineDuration(event.currentTarget.duration);
                }
              }}
              onLoadedMetadata={(event) => {
                if (Number.isFinite(event.currentTarget.duration)) {
                  setInlineDuration(event.currentTarget.duration);
                }
              }}
              onPause={() => setInlinePlaying(false)}
              onPlay={() => {
                setInlinePlaying(true);
                revealInlineControls();
              }}
              onTimeUpdate={(event) => setInlineCurrentTime(event.currentTarget.currentTime)}
              playsInline
              preload="auto"
              ref={inlineVideo}
              src={selectedItem.videoUrl}
            />
          )}
          <span className="profile-media-feature-position">
            {selectedItem.kind === "photo" ? "Photo" : "TV"} {selectedIndex + 1} of {activeItems.length}
          </span>
          {selectedItem.kind === "video" ? (
            <div
              className={`profile-media-video-controls${inlineControlsVisible || !inlinePlaying ? " is-visible" : ""}`}
              data-profile-media-control
              onClick={(event) => event.stopPropagation()}
              onFocusCapture={revealInlineControls}
              onPointerEnter={revealInlineControls}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                aria-label={inlinePlaying ? "Pause TV video" : "Play TV video"}
                className="profile-media-playback-control"
                onClick={toggleInlinePlayback}
                type="button"
              >
                <PlaybackStateIcon paused={!inlinePlaying} />
              </button>
              <input
                aria-label="TV video progress"
                aria-valuetext={`${formatDuration(inlineCurrentTime)} of ${formatDuration(inlineDuration || selectedItem.durationSeconds)}`}
                max={Math.max(0.1, inlineDuration || selectedItem.durationSeconds)}
                min="0"
                onChange={(event) => seekInlineVideo(Number(event.currentTarget.value))}
                step="0.1"
                style={{
                  "--profile-inline-video-progress": `${inlineProgressPercent}%`,
                } as CSSProperties}
                type="range"
                value={Math.min(inlineCurrentTime, Math.max(0.1, inlineDuration || selectedItem.durationSeconds))}
              />
              <output>
                {formatDuration(inlineCurrentTime)} / {formatDuration(inlineDuration || selectedItem.durationSeconds)}
              </output>
              <button
                aria-label={inlineMuted ? "Turn TV video sound on" : "Turn TV video sound off"}
                className="profile-media-sound-control"
                onClick={toggleInlineSound}
                type="button"
              >
                <SoundStateIcon muted={inlineMuted} />
              </button>
              <button
                aria-label={`Open ${stageName} TV video ${selectedIndex + 1} full screen`}
                className="profile-media-fullscreen-control"
                onClick={() => openViewer(selectedIndex)}
                type="button"
              >
                <FullscreenIcon />
              </button>
            </div>
          ) : null}
          <button
            aria-label={`Previous ${activeTab === "photo" ? "photo" : "TV video"}`}
            className="profile-media-feature-previous"
            disabled={selectedIndex <= 0}
            onClick={() => showRelativeInlineItem(-1)}
            tabIndex={selectedItem.kind === "video" && !inlineControlsVisible && inlinePlaying ? -1 : 0}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label={`Next ${activeTab === "photo" ? "photo" : "TV video"}`}
            className="profile-media-feature-next"
            disabled={selectedIndex >= activeItems.length - 1}
            onClick={() => showRelativeInlineItem(1)}
            tabIndex={selectedItem.kind === "video" && !inlineControlsVisible && inlinePlaying ? -1 : 0}
            type="button"
          >
            ›
          </button>
        </div>
      ) : null}
      <div
        aria-label={`${stageName} ${activeTab === "photo" ? "photos" : "MyDancr TV videos"}`}
        className="profile-media-grid"
        id="dancer-profile-media-grid"
        role="tabpanel"
      >
        {activeItems.map((item, index) => (
          <button
            aria-label={`Select ${stageName} ${item.kind} ${index + 1} of ${activeItems.length}`}
            aria-pressed={selectedIndex === index}
            className={`profile-media-grid-item is-${item.kind}${selectedIndex === index ? " active" : ""}`}
            key={`${item.kind}-${item.id}`}
            onClick={() => setActiveIndex(index)}
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
          aria-label={`${stageName} TV video viewer`}
          aria-modal="true"
          className="profile-media-viewer"
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
            <video
              aria-label={`${stageName} TV video ${viewerIndex + 1} of ${viewerItems.length}`}
              autoPlay
              controls
              controlsList="nofullscreen noremoteplayback nodownload"
              disablePictureInPicture
              key={activeViewerItem.id}
              loop
              muted
              playsInline
              preload="auto"
              src={activeViewerItem.videoUrl}
            />
            <button
              aria-label="Previous TV video"
              className="profile-media-viewer-previous"
              disabled={viewerIndex <= 0}
              onClick={() => showRelativeViewerItem(-1)}
              type="button"
            >
              ‹
            </button>
            <button
              aria-label="Next TV video"
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
                TV {viewerIndex + 1} of {viewerItems.length}
              </span>
            </div>
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
          </div>
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

function PlaybackStateIcon({ paused }: { paused: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paused ? (
        <path className="is-fill" d="m9 7 8 5-8 5Z" />
      ) : (
        <path className="is-fill" d="M7 6h3v12H7zM14 6h3v12h-3z" />
      )}
    </svg>
  );
}

function SoundStateIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 10v4h4l5 4V6L8 10H4Z" />
      {muted ? (
        <>
          <path d="m17 9 4 6" />
          <path d="m21 9-4 6" />
        </>
      ) : (
        <>
          <path d="M16 9.5a4 4 0 0 1 0 5" />
          <path d="M18.5 7a7.5 7.5 0 0 1 0 10" />
        </>
      )}
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
    </svg>
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
