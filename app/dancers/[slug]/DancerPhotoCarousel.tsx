"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

type DancerPhotoCarouselProps = {
  photos: Array<{
    id: string;
    imageUrl: string;
  }>;
  videos?: Array<{
    id: string;
    videoUrl: string;
    caption: string;
    durationSeconds: number;
  }>;
  stageName: string;
};

type ProfileMedia =
  | {
      id: string;
      kind: "photo";
      imageUrl: string;
    }
  | {
      id: string;
      kind: "video";
      videoUrl: string;
      caption: string;
      durationSeconds: number;
    };

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
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const gesture = useRef<SwipeGesture>({
    pointerId: null,
    startX: 0,
    startY: 0,
    horizontal: false,
    cancelled: false,
  });
  const trackpadLockedUntil = useRef(0);
  const activeVideo = useRef<HTMLVideoElement | null>(null);
  const thumbnailStrip = useRef<HTMLDivElement | null>(null);
  const thumbnailButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const availablePhotos = photos.filter((photo) => photo.imageUrl);
  const availableVideos = videos.filter((video) => video.videoUrl);
  const availableMedia: ProfileMedia[] = [
    ...availablePhotos.map((photo) => ({
      ...photo,
      kind: "photo" as const,
    })),
    ...availableVideos.map((video) => ({
      ...video,
      kind: "video" as const,
    })),
  ];
  const safeActiveIndex = availableMedia.length
    ? activeIndex % availableMedia.length
    : 0;
  const activeMedia = availableMedia[safeActiveIndex];

  const showPhoto = useCallback(
    (nextIndex: number) => {
      if (!availableMedia.length) return;
      activeVideo.current?.pause();
      setIsVideoPlaying(false);
      setActiveIndex(
        (nextIndex + availableMedia.length) % availableMedia.length,
      );
    },
    [availableMedia.length],
  );

  const movePhoto = useCallback(
    (direction: -1 | 1) => {
      if (availableMedia.length < 2) return;
      activeVideo.current?.pause();
      setIsVideoPlaying(false);
      setActiveIndex((currentIndex) => {
        const normalizedIndex = currentIndex % availableMedia.length;
        return (
          normalizedIndex + direction + availableMedia.length
        ) % availableMedia.length;
      });
    },
    [availableMedia.length],
  );

  useEffect(() => {
    const strip = thumbnailStrip.current;
    const selectedThumbnail = thumbnailButtons.current[safeActiveIndex];
    if (!strip || !selectedThumbnail) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    strip.scrollTo({
      behavior: reducedMotion ? "auto" : "smooth",
      left:
        selectedThumbnail.offsetLeft -
        (strip.clientWidth - selectedThumbnail.offsetWidth) / 2,
    });
  }, [safeActiveIndex]);

  const resetGesture = () => {
    gesture.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      horizontal: false,
      cancelled: false,
    };
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      (event.target as HTMLElement).closest("button, a, video")
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
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
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
  };

  const handlePointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
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
      movePhoto(distanceX < 0 ? 1 : -1);
    }
    resetGesture();
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (
      availableMedia.length < 2 ||
      Math.abs(event.deltaX) < 18 ||
      Math.abs(event.deltaX) <= Math.abs(event.deltaY)
    ) {
      return;
    }
    event.preventDefault();
    const now = Date.now();
    if (now < trackpadLockedUntil.current) return;
    trackpadLockedUntil.current = now + TRACKPAD_LOCK_MS;
    movePhoto(event.deltaX > 0 ? 1 : -1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("video")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      movePhoto(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      movePhoto(1);
    }
  };

  const playSelectedVideo = () => {
    if (!activeVideo.current) return;
    void activeVideo.current.play().catch(() => {
      setIsVideoPlaying(false);
    });
  };

  return (
    <div
      aria-label={`${stageName} profile photos and videos`}
      aria-roledescription="carousel"
      className="public-photo public-gallery"
      data-active-media-index={safeActiveIndex}
      data-active-media-type={activeMedia?.kind || "empty"}
      data-active-photo-index={safeActiveIndex}
      data-dancer-media-carousel
      data-dancer-photo-carousel
      onKeyDown={handleKeyDown}
      onPointerCancel={resetGesture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onWheel={handleWheel}
      role="group"
      tabIndex={0}
    >
      <div className="public-media-stage">
        {activeMedia?.kind === "photo" ? (
          <img
            alt={`${stageName} profile photo ${safeActiveIndex + 1} of ${availableMedia.length}`}
            className="public-photo-image"
            decoding="async"
            draggable={false}
            src={activeMedia.imageUrl}
          />
        ) : activeMedia?.kind === "video" ? (
          <div className="public-profile-video">
            <video
              aria-label={`${stageName} profile video ${safeActiveIndex + 1} of ${availableMedia.length}`}
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              onEnded={() => setIsVideoPlaying(false)}
              onPause={() => setIsVideoPlaying(false)}
              onPlay={() => setIsVideoPlaying(true)}
              playsInline
              preload="metadata"
              ref={activeVideo}
              src={activeMedia.videoUrl}
            />
            {!isVideoPlaying ? (
              <button
                aria-label={`Play ${stageName} profile video ${safeActiveIndex + 1}`}
                className="public-profile-play"
                onClick={playSelectedVideo}
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            ) : null}
            {activeMedia.caption.trim() ? (
              <p className="public-video-caption">{activeMedia.caption}</p>
            ) : null}
          </div>
        ) : (
          <span className="public-media-empty">{initials(stageName)}</span>
        )}
        {availableMedia.length > 1 ? (
          <>
          <button
            aria-label="Show previous profile media"
            className="public-photo-nav previous"
            onClick={() => movePhoto(-1)}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="Show next profile media"
            className="public-photo-nav next"
            onClick={() => movePhoto(1)}
            type="button"
          >
            ›
          </button>
          </>
        ) : null}
      </div>
      {availableMedia.length > 1 ? (
        <div
          aria-label="Choose profile photo or video"
          className="public-media-thumbnails"
          ref={thumbnailStrip}
          role="group"
        >
          {availableMedia.map((media, index) => {
            const isSelected = index === safeActiveIndex;
            return (
              <button
                aria-current={isSelected ? "true" : undefined}
                aria-label={`Show profile ${media.kind} ${index + 1} of ${availableMedia.length}`}
                aria-pressed={isSelected}
                className={`public-media-thumbnail${isSelected ? " is-selected" : ""}${media.kind === "video" ? " is-video" : ""}`}
                key={`${media.kind}-${media.id}`}
                onClick={() => showPhoto(index)}
                ref={(element) => {
                  thumbnailButtons.current[index] = element;
                }}
                type="button"
              >
                {media.kind === "photo" ? (
                  <img
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    draggable={false}
                    src={media.imageUrl}
                  />
                ) : (
                  <>
                    <video
                      aria-hidden="true"
                      muted
                      playsInline
                      preload="metadata"
                      src={media.videoUrl}
                      tabIndex={-1}
                    />
                    <span
                      aria-hidden="true"
                      className="public-media-thumbnail-play"
                    />
                    <span className="public-media-thumbnail-duration">
                      {formatDuration(media.durationSeconds)}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      <span aria-live="polite" className="public-photo-status">
        {activeMedia?.kind === "video" ? "Video" : "Photo"}{" "}
        {availableMedia.length ? safeActiveIndex + 1 : 0} of{" "}
        {availableMedia.length}
      </span>
    </div>
  );
}

function formatDuration(durationSeconds: number) {
  const seconds = Math.max(0, Math.round(durationSeconds));
  return `0:${String(seconds).padStart(2, "0")}`;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
