"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  const deepLinkHandled = useRef(false);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const viewerRoot = useRef<HTMLDivElement | null>(null);
  const viewerFeed = useRef<HTMLDivElement | null>(null);
  const viewerOwnsFullscreen = useRef(false);
  const viewerTrigger = useRef<HTMLButtonElement | null>(null);
  const pendingViewerIndex = useRef(0);
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
  const viewerKind = viewer?.kind;
  const activeTabId = `${tabGroupId}-${activeTab}-tab`;
  const panelId = `${tabGroupId}-panel`;
  const scrollViewerToIndex = useCallback((
    index: number,
    options: { instant?: boolean } = {},
  ) => {
    const feed = viewerFeed.current;
    if (!feed) return false;
    const slide = feed.querySelector<HTMLElement>(
      `[data-profile-media-viewer-index="${index}"]`,
    );
    feed.scrollTo({
      behavior: options.instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      top: slide?.offsetTop ?? index * feed.clientHeight,
    });
    return true;
  }, []);
  const currentViewerScrollIndex = useCallback(() => {
    const feed = viewerFeed.current;
    if (!feed) return 0;
    const slides = [...feed.querySelectorAll<HTMLElement>("[data-profile-media-viewer-index]")];
    if (!slides.length) return 0;
    return slides.reduce((closestIndex, slide, index) => (
      Math.abs(slide.offsetTop - feed.scrollTop) <
      Math.abs(slides[closestIndex].offsetTop - feed.scrollTop)
        ? index
        : closestIndex
    ), 0);
  }, []);

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
    pendingViewerIndex.current = index;
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
      if (fullscreenElement() === viewerRoot.current) {
        viewerOwnsFullscreen.current = true;
        window.requestAnimationFrame(() => {
          scrollViewerToIndex(pendingViewerIndex.current, { instant: true });
        });
      } else {
        viewerOwnsFullscreen.current = false;
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, [scrollViewerToIndex]);

  useEffect(() => {
    if (!viewerKind) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      scrollViewerToIndex(pendingViewerIndex.current, { instant: true });
      closeButton.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [scrollViewerToIndex, viewerKind]);

  useEffect(() => {
    if (!viewerKind) return;
    const feed = viewerFeed.current;
    if (!feed) return;
    const videos = [...feed.querySelectorAll<HTMLVideoElement>("video")];
    videos.forEach((video, index) => {
      video.muted = inlineMuted;
      if (index === viewerIndex && viewerKind === "video") {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    });
  }, [inlineMuted, viewerIndex, viewerKind]);

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
      const currentIndex = currentViewerScrollIndex();
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), itemCount - 1);
      if (nextIndex === currentIndex) return;
      setShareStatus("");
      scrollViewerToIndex(nextIndex);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [currentViewerScrollIndex, photoMedia.length, scrollViewerToIndex, videoMedia.length, viewerKind]);

  function openViewer(
    kind: MediaTab,
    index: number,
    trigger: HTMLButtonElement,
  ) {
    viewerTrigger.current = trigger;
    pendingViewerIndex.current = index;
    setShareStatus("");
    flushSync(() => setViewer({ kind, index }));
    window.requestAnimationFrame(() => scrollViewerToIndex(index, { instant: true }));
    void requestViewerFullscreen(index);
  }

  function closeViewer() {
    exitViewerFullscreen();
    setViewer(null);
    setShareStatus("");
    clearMediaDeepLink();
    window.requestAnimationFrame(() => viewerTrigger.current?.focus());
  }

  async function requestViewerFullscreen(requestedIndex: number) {
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
      if (viewerOwnsFullscreen.current) {
        window.requestAnimationFrame(() => {
          scrollViewerToIndex(requestedIndex, { instant: true });
        });
      }
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
    const nextIndex = Math.min(
      Math.max(viewerIndex + direction, 0),
      Math.max(0, viewerItems.length - 1),
    );
    if (nextIndex === viewerIndex) return;
    setShareStatus("");
    scrollViewerToIndex(nextIndex);
  }

  function handleViewerScroll() {
    const nextIndex = Math.min(
      Math.max(currentViewerScrollIndex(), 0),
      Math.max(0, viewerItems.length - 1),
    );
    pendingViewerIndex.current = nextIndex;
    setViewer((current) => {
      if (!current || current.index === nextIndex) return current;
      return { ...current, index: nextIndex };
    });
    setShareStatus("");
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
            key={`${item.kind}-${item.id}-${index}`}
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
            data-profile-media-snap-feed
            onScroll={handleViewerScroll}
            ref={viewerFeed}
          >
            {viewerItems.map((item, index) => (
              <section
                aria-label={`${stageName} ${item.kind} ${index + 1} of ${viewerItems.length}`}
                className="profile-media-viewer-slide"
                data-profile-media-viewer-index={index}
                key={`${item.kind}-viewer-${item.id}-${index}`}
              >
                {item.kind === "photo" ? (
                  <img
                    alt={`${stageName} photo ${index + 1} of ${viewerItems.length}`}
                    decoding={index === viewerIndex ? "sync" : "async"}
                    draggable={false}
                    height={item.imageHeight || undefined}
                    loading={Math.abs(index - viewerIndex) <= 1 ? "eager" : "lazy"}
                    sizes="100vw"
                    src={item.imageUrl}
                    srcSet={item.imageSrcSet || undefined}
                    width={item.imageWidth || undefined}
                  />
                ) : (
                  <video
                    aria-label={`${stageName} video ${index + 1} of ${viewerItems.length}`}
                    controls
                    controlsList="nofullscreen noremoteplayback nodownload"
                    disablePictureInPicture
                    loop
                    muted={inlineMuted}
                    onVolumeChange={(event) => {
                      if (event.currentTarget.muted !== inlineMuted) {
                        setInlineMuted(event.currentTarget.muted);
                      }
                    }}
                    playsInline
                    poster={item.posterUrl || undefined}
                    preload={Math.abs(index - viewerIndex) <= 1 ? "auto" : "metadata"}
                    src={item.videoUrl}
                  />
                )}
              </section>
            ))}
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
            {viewer.kind === "video" ? (
              <div className="profile-media-viewer-copy">
                <strong>{stageName}</strong>
                <span>
                  {viewerStatus} · Scroll up or down · Video {viewerIndex + 1} of {viewerItems.length}
                </span>
              </div>
            ) : null}
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
