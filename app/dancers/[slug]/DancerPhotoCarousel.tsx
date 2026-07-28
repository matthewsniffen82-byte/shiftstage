"use client";

import { useCallback, useRef, useState } from "react";
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
  stageName: string;
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
  stageName,
}: DancerPhotoCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const gesture = useRef<SwipeGesture>({
    pointerId: null,
    startX: 0,
    startY: 0,
    horizontal: false,
    cancelled: false,
  });
  const trackpadLockedUntil = useRef(0);
  const availablePhotos = photos.filter((photo) => photo.imageUrl);
  const safeActiveIndex = availablePhotos.length
    ? activeIndex % availablePhotos.length
    : 0;
  const activePhoto = availablePhotos[safeActiveIndex];

  const showPhoto = useCallback(
    (nextIndex: number) => {
      if (!availablePhotos.length) return;
      setActiveIndex(
        (nextIndex + availablePhotos.length) % availablePhotos.length,
      );
    },
    [availablePhotos.length],
  );

  const movePhoto = useCallback(
    (direction: -1 | 1) => {
      if (availablePhotos.length < 2) return;
      setActiveIndex((currentIndex) => {
        const normalizedIndex = currentIndex % availablePhotos.length;
        return (
          normalizedIndex + direction + availablePhotos.length
        ) % availablePhotos.length;
      });
    },
    [availablePhotos.length],
  );

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
      (event.target as HTMLElement).closest("button, a")
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
      availablePhotos.length < 2 ||
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
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      movePhoto(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      movePhoto(1);
    }
  };

  return (
    <div
      aria-label={`${stageName} profile pictures`}
      aria-roledescription="carousel"
      className="public-photo"
      data-active-photo-index={safeActiveIndex}
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
      {activePhoto ? (
        <div
          aria-label={`${stageName} profile photo ${safeActiveIndex + 1} of ${availablePhotos.length}`}
          className="public-photo-image"
          role="img"
          style={{ backgroundImage: `url(${activePhoto.imageUrl})` }}
        />
      ) : (
        <span>{initials(stageName)}</span>
      )}
      {availablePhotos.length > 1 ? (
        <>
          <button
            aria-label="Show previous profile photo"
            className="public-photo-nav previous"
            onClick={() => movePhoto(-1)}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="Show next profile photo"
            className="public-photo-nav next"
            onClick={() => movePhoto(1)}
            type="button"
          >
            ›
          </button>
          <div
            aria-label="Choose profile photo"
            className="public-photo-dots"
            role="group"
          >
            {availablePhotos.map((photo, index) => (
              <button
                aria-label={`Show profile photo ${index + 1}`}
                aria-pressed={index === safeActiveIndex}
                key={photo.id}
                onClick={() => showPhoto(index)}
                type="button"
              />
            ))}
          </div>
          <span aria-live="polite" className="public-photo-status">
            Photo {safeActiveIndex + 1} of {availablePhotos.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
