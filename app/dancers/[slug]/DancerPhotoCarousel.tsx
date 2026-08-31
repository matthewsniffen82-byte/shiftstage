"use client";

import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { MediaLikeButton } from "@/app/components/MediaLikeButton";
import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";
import { recordPublicEngagementShare } from "@/src/lib/dancr/engagement-client";
import { useVideoSoundPreference } from "@/src/lib/dancr/use-video-sound-preference";
import { useAdaptiveVideoWarmup } from "@/src/lib/dancr/use-adaptive-video-warmup";
import { useAnonymousMediaLikes } from "@/src/lib/dancr/use-anonymous-media-likes";
import { DANCER_PROFILE_MEDIA_PAGE_SIZE } from "@/src/lib/dancr/media-limits";

type DancerPhotoCarouselProps = {
  dancerId?: string;
  photos: Array<{
    id: string;
    imageUrl: string;
    imageSrcSet?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    likeCount?: number;
  }>;
  videos?: Array<{
    id: string;
    videoUrl: string;
    posterUrl?: string | null;
    durationSeconds: number;
    likeCount?: number;
  }>;
  stageName: string;
  socialContent?: ReactNode;
  viewerStatus?: string;
};

type PhotoMedia = {
  id: string;
  kind: "photo";
  imageUrl: string;
  imageSrcSet?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  likeCount?: number;
};

type VideoMedia = {
  id: string;
  kind: "video";
  videoUrl: string;
  posterUrl: string | null;
  durationSeconds: number;
  likeCount?: number;
};

type ProfileMedia = PhotoMedia | VideoMedia;
type MediaTab = ProfileMedia["kind"];
type MediaViewer = { kind: MediaTab; index: number };
type PlaybackFeedback = { index: number; paused: boolean; key: number };
type MediaReportTarget = {
  key: string;
  targetId: string;
  targetLabel: string;
  targetType: "dancer_profile" | "profile_photo" | "tv_video";
  title: string;
};

const MEDIA_REPORT_REASONS = [
  "Sexual or unsafe content",
  "Harassment or abuse",
  "Spam or misleading content",
  "Other safety concern",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DancerPhotoCarousel({
  dancerId,
  photos,
  videos = [],
  stageName,
  socialContent,
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
  const mediaLikeSeeds = useMemo(() => [
    ...photoMedia.map((item) => ({ mediaType: "photo" as const, mediaId: item.id, likeCount: item.likeCount })),
    ...videoMedia.map((item) => ({ mediaType: "video" as const, mediaId: item.id, likeCount: item.likeCount })),
  ], [photoMedia, videoMedia]);
  const { stateFor: mediaLikeStateFor, toggle: toggleMediaLike } = useAnonymousMediaLikes(mediaLikeSeeds);
  const [activeTab, setActiveTab] = useState<MediaTab>(
    photoMedia.length || !videoMedia.length ? "photo" : "video",
  );
  const [viewer, setViewer] = useState<MediaViewer | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<MediaTab, number>>({
    photo: DANCER_PROFILE_MEDIA_PAGE_SIZE,
    video: DANCER_PROFILE_MEDIA_PAGE_SIZE,
  });
  const [inlineMuted, setInlineMuted] = useVideoSoundPreference();
  const allowVideoWarmup = useAdaptiveVideoWarmup();
  const [loadedViewerVideoIndex, setLoadedViewerVideoIndex] = useState(-1);
  const [shareStatus, setShareStatus] = useState("");
  const [reportTarget, setReportTarget] = useState<MediaReportTarget | null>(null);
  const [reportError, setReportError] = useState("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportedTargets, setReportedTargets] = useState<string[]>([]);
  const [playbackFeedback, setPlaybackFeedback] = useState<PlaybackFeedback | null>(null);
  const deepLinkHandled = useRef(false);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const viewerRoot = useRef<HTMLDivElement | null>(null);
  const viewerFeed = useRef<HTMLDivElement | null>(null);
  const viewerOwnsFullscreen = useRef(false);
  const viewerTrigger = useRef<HTMLButtonElement | null>(null);
  const pendingViewerIndex = useRef(0);
  const viewerOpeningIndex = useRef<number | null>(null);
  const viewerOpeningFrame = useRef(0);
  const playbackTapIndex = useRef<number | null>(null);
  const playbackTapTimer = useRef(0);
  const playbackFeedbackTimer = useRef(0);
  const playbackFeedbackKey = useRef(0);
  const reportAbortRef = useRef<AbortController | null>(null);
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
  const settleViewerAtIndex = useCallback((index: number) => {
    if (viewerOpeningIndex.current !== index) return;
    window.cancelAnimationFrame(viewerOpeningFrame.current);
    let remainingFrames = 3;
    const settle = () => {
      if (viewerOpeningIndex.current !== index) return;
      scrollViewerToIndex(index, { instant: true });
      if (remainingFrames > 0) {
        remainingFrames -= 1;
        viewerOpeningFrame.current = window.requestAnimationFrame(settle);
        return;
      }
      viewerOpeningFrame.current = 0;
      pendingViewerIndex.current = index;
      if (viewerOpeningIndex.current === index) viewerOpeningIndex.current = null;
      setViewer((current) => current ? { ...current, index } : current);
    };
    viewerOpeningFrame.current = window.requestAnimationFrame(settle);
  }, [scrollViewerToIndex]);
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
    viewerOpeningIndex.current = index;
    setActiveTab(requestedKind);
    setViewer({ kind: requestedKind, index });
    settleViewerAtIndex(index);
  }, [photoMedia, settleViewerAtIndex, videoMedia]);

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
      if (viewerHasFullscreen(viewerRoot.current)) {
        viewerOwnsFullscreen.current = true;
        const requestedIndex = viewerOpeningIndex.current ?? pendingViewerIndex.current;
        window.requestAnimationFrame(() => {
          scrollViewerToIndex(requestedIndex, { instant: true });
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
      scrollViewerToIndex(viewerOpeningIndex.current ?? pendingViewerIndex.current, { instant: true });
      closeButton.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [scrollViewerToIndex, viewerKind]);

  useEffect(() => () => {
    window.clearTimeout(playbackTapTimer.current);
    window.clearTimeout(playbackFeedbackTimer.current);
    reportAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!viewerKind) return;
    const feed = viewerFeed.current;
    if (!feed) return;
    const videos = [...feed.querySelectorAll<HTMLVideoElement>("video")];
    videos.forEach((video, index) => {
      video.muted = inlineMuted;
      if (index === viewerIndex && viewerKind === "video") {
        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          loadedViewerVideoIndex !== viewerIndex
        ) {
          setLoadedViewerVideoIndex(viewerIndex);
        }
        void video.play().catch(() => undefined);
      } else {
        video.pause();
        if (!video.hasAttribute("src")) video.load();
      }
    });
  }, [allowVideoWarmup, inlineMuted, loadedViewerVideoIndex, viewerIndex, viewerKind]);

  useEffect(() => {
    if (!viewerKind) return;
    const itemCount = viewerKind === "photo" ? photoMedia.length : videoMedia.length;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (reportTarget && !reportSaving) {
          setReportTarget(null);
          setReportError("");
          return;
        }
        exitViewerFullscreen();
        window.cancelAnimationFrame(viewerOpeningFrame.current);
        viewerOpeningFrame.current = 0;
        viewerOpeningIndex.current = null;
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
  }, [currentViewerScrollIndex, photoMedia.length, reportSaving, reportTarget, scrollViewerToIndex, videoMedia.length, viewerKind]);

  function openViewer(
    kind: MediaTab,
    index: number,
    trigger: HTMLButtonElement,
  ) {
    viewerTrigger.current = trigger;
    pendingViewerIndex.current = index;
    viewerOpeningIndex.current = index;
    setShareStatus("");
    setReportTarget(null);
    flushSync(() => setViewer({ kind, index }));
    window.requestAnimationFrame(() => scrollViewerToIndex(index, { instant: true }));
    void requestViewerFullscreen(index);
  }

  function closeViewer() {
    exitViewerFullscreen();
    window.cancelAnimationFrame(viewerOpeningFrame.current);
    viewerOpeningFrame.current = 0;
    viewerOpeningIndex.current = null;
    setViewer(null);
    setShareStatus("");
    setReportTarget(null);
    setReportError("");
    setPlaybackFeedback(null);
    playbackTapIndex.current = null;
    window.clearTimeout(playbackTapTimer.current);
    window.clearTimeout(playbackFeedbackTimer.current);
    clearMediaDeepLink();
    window.requestAnimationFrame(() => viewerTrigger.current?.focus());
  }

  function showPlaybackFeedback(index: number, paused: boolean) {
    window.clearTimeout(playbackFeedbackTimer.current);
    playbackFeedbackKey.current += 1;
    setPlaybackFeedback({ index, paused, key: playbackFeedbackKey.current });
    playbackFeedbackTimer.current = window.setTimeout(() => setPlaybackFeedback(null), 850);
  }

  function handleViewerPlaybackChange(index: number, paused: boolean) {
    if (playbackTapIndex.current !== index) return;
    playbackTapIndex.current = null;
    window.clearTimeout(playbackTapTimer.current);
    showPlaybackFeedback(index, paused);
  }

  async function requestViewerFullscreen(requestedIndex: number) {
    const element = viewerRoot.current as FullscreenViewerElement | null;
    if (!element) {
      settleViewerAtIndex(requestedIndex);
      return;
    }
    const activeFullscreenElement = fullscreenElement();
    if (activeFullscreenElement) {
      viewerOwnsFullscreen.current = viewerHasFullscreen(element, activeFullscreenElement);
      settleViewerAtIndex(requestedIndex);
      return;
    }
    const root = document.documentElement as FullscreenViewerElement;
    const targets = root === element ? [root] : [root, element];
    try {
      for (const target of targets) {
        const requests: Array<() => Promise<void> | void> = [];
        if (typeof target.requestFullscreen === "function") {
          requests.push(() => target.requestFullscreen({ navigationUI: "hide" }));
          requests.push(() => target.requestFullscreen());
        }
        if (typeof target.webkitRequestFullscreen === "function") {
          requests.push(() => target.webkitRequestFullscreen?.());
        }
        for (const request of requests) {
          try {
            await request();
          } catch {
            continue;
          }
          viewerOwnsFullscreen.current = viewerHasFullscreen(element);
          if (viewerOwnsFullscreen.current) return;
        }
      }
      viewerOwnsFullscreen.current = false;
    } finally {
      settleViewerAtIndex(requestedIndex);
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
        void recordPublicEngagementShare(activeViewerItem.kind, activeViewerItem.id);
        setShareStatus(isVideo ? "Video shared." : "Photo shared.");
        return;
      }
      await copyViewerShareUrl(url);
      void recordPublicEngagementShare(activeViewerItem.kind, activeViewerItem.id);
      setShareStatus(isVideo ? "Video link copied." : "Photo link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus(isVideo ? "Unable to share this video." : "Unable to share this photo.");
    }
  }

  function activeMediaReportTarget(): MediaReportTarget | null {
    if (!activeViewerItem || !dancerId) return null;
    if (activeViewerItem.kind === "video" && UUID_PATTERN.test(activeViewerItem.id)) {
      return {
        key: `tv_video:${activeViewerItem.id}`,
        targetId: activeViewerItem.id,
        targetLabel: `${stageName} profile video ${viewerIndex + 1}`,
        targetType: "tv_video",
        title: "Report video",
      };
    }
    if (UUID_PATTERN.test(activeViewerItem.id)) {
      return {
        key: `profile_photo:${activeViewerItem.id}`,
        targetId: activeViewerItem.id,
        targetLabel: `${stageName} profile photo ${viewerIndex + 1}`,
        targetType: "profile_photo",
        title: "Report photo",
      };
    }
    return {
      key: `dancer_profile:${dancerId}:${activeViewerItem.kind}`,
      targetId: dancerId,
      targetLabel: `${stageName} profile ${activeViewerItem.kind}`,
      targetType: "dancer_profile",
      title: `Report ${activeViewerItem.kind}`,
    };
  }

  function openMediaReport() {
    const target = activeMediaReportTarget();
    if (!target || reportSaving || reportedTargets.includes(target.key)) return;
    setReportError("");
    setReportTarget(target);
  }

  async function submitMediaReport(reason: (typeof MEDIA_REPORT_REASONS)[number]) {
    if (!reportTarget || reportSaving) return;
    const controller = new AbortController();
    reportAbortRef.current?.abort();
    reportAbortRef.current = controller;
    setReportSaving(true);
    setReportError("");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const accessToken = readBrowserAccessToken("customer");
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
      const response = await fetch("/api/reports", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          targetType: reportTarget.targetType,
          targetId: reportTarget.targetId,
          targetLabel: reportTarget.targetLabel,
          reason,
          details: null,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok || !data.ok || !data.report) {
        throw new Error(data.error || "Unable to submit report.");
      }
      setReportedTargets((current) => current.includes(reportTarget.key) ? current : [...current, reportTarget.key]);
      setShareStatus("Report submitted for review.");
      setReportTarget(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setReportError(error instanceof Error ? error.message : "Unable to submit report.");
    } finally {
      if (reportAbortRef.current === controller) reportAbortRef.current = null;
      if (!controller.signal.aborted) setReportSaving(false);
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
    if (viewerOpeningIndex.current !== null) {
      scrollViewerToIndex(viewerOpeningIndex.current, { instant: true });
      return;
    }
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
      {socialContent ? (
        <div className="profile-media-socials" aria-label="External profiles">
          {socialContent}
        </div>
      ) : null}
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
                data-image-state="loading"
                decoding="async"
                draggable={false}
                height={item.imageHeight || undefined}
                loading="lazy"
                onError={markImageUnavailable}
                onLoad={markImageReady}
                ref={settleImageElement}
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
                    data-image-state="loading"
                    decoding="async"
                    draggable={false}
                    loading="lazy"
                    onError={markImageUnavailable}
                    onLoad={markImageReady}
                    ref={settleImageElement}
                    src={item.posterUrl}
                  />
                ) : (
                  <span aria-hidden="true" className="profile-media-poster-placeholder" />
                )}
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
                    data-image-state="loading"
                    decoding={index === viewerIndex ? "sync" : "async"}
                    draggable={false}
                    height={item.imageHeight || undefined}
                    loading={Math.abs(index - viewerIndex) <= 1 ? "eager" : "lazy"}
                    onClick={() => {
                      if (!fullscreenElement()) void requestViewerFullscreen(viewerIndex);
                    }}
                    onError={markImageUnavailable}
                    onLoad={markImageReady}
                    ref={settleImageElement}
                    sizes="100vw"
                    src={Math.abs(index - viewerIndex) <= 1 ? item.imageUrl : undefined}
                    srcSet={Math.abs(index - viewerIndex) <= 1 ? item.imageSrcSet || undefined : undefined}
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
                    onPause={() => handleViewerPlaybackChange(index, true)}
                    onPlay={() => handleViewerPlaybackChange(index, false)}
                    onLoadedData={() => {
                      if (index === viewerIndex) setLoadedViewerVideoIndex(index);
                    }}
                    onPointerDown={() => {
                      playbackTapIndex.current = index;
                      window.clearTimeout(playbackTapTimer.current);
                      playbackTapTimer.current = window.setTimeout(() => {
                        if (playbackTapIndex.current === index) playbackTapIndex.current = null;
                      }, 500);
                    }}
                    onVolumeChange={(event) => {
                      if (event.currentTarget.muted !== inlineMuted) {
                        setInlineMuted(event.currentTarget.muted);
                      }
                    }}
                    playsInline
                    poster={Math.abs(index - viewerIndex) <= 2 ? item.posterUrl || undefined : undefined}
                    preload={index === viewerIndex
                      ? "auto"
                      : allowVideoWarmup && loadedViewerVideoIndex === viewerIndex && index === viewerIndex + 1
                        ? "metadata"
                        : "none"}
                    src={index === viewerIndex || (
                      allowVideoWarmup &&
                      loadedViewerVideoIndex === viewerIndex &&
                      index === viewerIndex + 1
                    ) ? item.videoUrl : undefined}
                  />
                )}
                {item.kind === "video" && playbackFeedback?.index === index ? (
                  <span
                    aria-hidden="true"
                    className="profile-media-playback-feedback"
                    key={playbackFeedback.key}
                  >
                    <PlaybackFeedbackIcon paused={playbackFeedback.paused} />
                  </span>
                ) : null}
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
              {(() => {
                const like = mediaLikeStateFor(activeViewerItem.kind, activeViewerItem.id);
                return (
                  <MediaLikeButton
                    className="profile-media-viewer-like"
                    liked={like.liked}
                    likeCount={like.likeCount}
                    mediaType={activeViewerItem.kind}
                    pending={like.pending}
                    onToggle={() => {
                      setShareStatus("");
                      void toggleMediaLike(activeViewerItem.kind, activeViewerItem.id).catch(() => {
                        setShareStatus("Unable to update this like.");
                      });
                    }}
                  />
                );
              })()}
              <button
                aria-label={activeViewerItem.kind === "video" ? "Share this TV video" : "Share this profile photo"}
                className="profile-media-viewer-share"
                onClick={shareViewerItem}
                type="button"
              >
                <ShareIcon />
              </button>
              {(() => {
                const target = activeMediaReportTarget();
                return target ? (
                  <button
                    aria-label={reportedTargets.includes(target.key) ? "Media reported" : `Report this profile ${activeViewerItem.kind}`}
                    className="profile-media-viewer-report"
                    disabled={reportSaving || reportedTargets.includes(target.key)}
                    onClick={openMediaReport}
                    type="button"
                  >
                    <ReportIcon />
                  </button>
                ) : null;
              })()}
              <span aria-live="polite" className="profile-media-viewer-share-status">
                {shareStatus}
              </span>
            </div>
          </div>
          {reportTarget ? (
            <div
              className="profile-report-gate profile-media-report-gate"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !reportSaving) setReportTarget(null);
              }}
            >
              <section
                aria-labelledby="profile-media-report-title"
                aria-modal="true"
                className="profile-report-dialog profile-media-report-dialog"
                role="dialog"
              >
                <h2 id="profile-media-report-title">{reportTarget.title}</h2>
                <div className="profile-media-report-options" role="menu">
                  {MEDIA_REPORT_REASONS.map((reason, index) => (
                    <button
                      autoFocus={index === 0}
                      disabled={reportSaving}
                      key={reason}
                      onClick={() => void submitMediaReport(reason)}
                      role="menuitem"
                      type="button"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                {reportError ? <p className="profile-report-error" role="alert">{reportError}</p> : null}
              </section>
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

type FullscreenViewerElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenElement() {
  return document.fullscreenElement ||
    (document as FullscreenViewerDocument).webkitFullscreenElement ||
    null;
}

function viewerHasFullscreen(
  viewer: Element | null,
  activeFullscreenElement = fullscreenElement(),
) {
  return Boolean(viewer && activeFullscreenElement) && (
    activeFullscreenElement === viewer || activeFullscreenElement === document.documentElement
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

function ReportIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 21V4" />
      <path d="M5 5h11l-1.8 3L16 11H5" />
    </svg>
  );
}

function PlaybackFeedbackIcon({ paused }: { paused: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={paused ? "m9 7 8 5-8 5Z" : "M7 6h3v12H7zM14 6h3v12h-3z"} />
    </svg>
  );
}

function markImageReady(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.dataset.imageState = "ready";
}

function markImageUnavailable(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.dataset.imageState = "error";
}

function settleImageElement(image: HTMLImageElement | null) {
  if (!image?.complete) return;
  image.dataset.imageState = image.naturalWidth > 0 ? "ready" : "error";
}

function clearMediaDeepLink() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("media") && !url.searchParams.has("mediaIndex")) return;
  url.searchParams.delete("media");
  url.searchParams.delete("mediaIndex");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}
