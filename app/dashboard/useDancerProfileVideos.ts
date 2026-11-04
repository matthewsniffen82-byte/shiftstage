"use client";
import { useEffect, useState } from "react";
import { readSession, requestDancerTvVideosJson } from "./dashboard-session";
import { DANCER_PROFILE_VIDEOS_CHANGED_EVENT } from "./dancer-profile-media-sync";
import type { DancerPreviewVideo } from "./dashboard-types";
export function useDancerProfileVideos(profileId: unknown, enabled = true) {
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [uploadedVideos, setUploadedVideos] = useState<DancerPreviewVideo[]>([]);
  useEffect(() => {
    if (!enabled) return;
    if (!readSession()?.accessToken) {
      setIsMediaLoading(false);
      setUploadedVideos([]);
      setMediaError("Sign in again to load your saved profile videos.");
      return;
    }

    let cancelled = false;
    let refreshTimer = 0;
    let failures = 0;
    let requestSequence = 0;
    let requestController: AbortController | null = null;
    const loadVideos = async (showLoading = false) => {
      window.clearTimeout(refreshTimer);
      const requestId = ++requestSequence;
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      if (showLoading) setIsMediaLoading(true);
      setMediaError("");
      try {
        const data = await requestDancerTvVideosJson({
          cache: "no-store",
          fallbackMessage: "Unable to load your saved profile videos.",
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted || requestId !== requestSequence) return;
        failures = 0;
        const savedVideos = Array.isArray(data?.videos) ? data.videos : [];
        setUploadedVideos(savedVideos.flatMap((video: Record<string, unknown>) => {
          const id = String(video?.id || "").trim();
          const videoUrl = String(video?.videoUrl || "").trim();
          const posterUrl = String(video?.posterUrl || "").trim();
          const status = String(video?.status || "").toLowerCase();
          if (!id || status === "hidden" || status === "removed" || status === "expired") return [];
          return [{
            id,
            status,
            fileChecksPassed: status === "approved" || (video.uploadValidationPending !== true && (video.moderationDetails as Record<string, unknown> | undefined)?.fileChecksPassed === true),
            distributionScope: video.distributionScope === "feed_only" ? "feed_only" as const : "profile_and_feed" as const,
            videoUrl,
            posterUrl: posterUrl || null,
            isPinned: video.isPinned === true,
            createdAt: String(video.createdAt || ""),
            durationSeconds: Math.max(0, Number(video?.durationSeconds || 0)),
          }];
        }));
        const hasProcessingVideo = savedVideos.some((video: Record<string, unknown>) => {
          const status = String(video?.status || "").toLowerCase();
          return status === "uploading" || status === "moderating";
        });
        const hasReviewVideo = savedVideos.some((video: Record<string, unknown>) => video.status === "submitted");
        window.clearTimeout(refreshTimer);
        if (hasProcessingVideo || hasReviewVideo) {
          refreshTimer = window.setTimeout(() => void loadVideos(), hasProcessingVideo ? 1_800 : 8_000);
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted || requestId !== requestSequence) return;
        const status = Number((error as { status?: number } | null)?.status);
        setMediaError(status === 408 ? "Your videos took too long to load. Please try again."
          : error instanceof Error ? error.message : "Unable to load your saved profile videos.");
        if (status !== 401 && status !== 403 && failures < 3) {
          const delay = Math.min(30_000, 8_000 * 2 ** failures++);
          refreshTimer = window.setTimeout(() => {
            if (document.visibilityState === "visible") void loadVideos(true);
          }, delay);
        }
      } finally {
        if (requestController === controller) requestController = null;
        if (!cancelled && !controller.signal.aborted && requestId === requestSequence) setIsMediaLoading(false);
      }
    };
    const refreshAfterVideoChange = () => {
      failures = 0;
      void loadVideos();
    };
    const refreshOnResume = () => {
      if (document.visibilityState !== "visible" || requestController || !readSession()?.accessToken) return;
      failures = 0;
      void loadVideos(true);
    };

    setUploadedVideos([]);
    void loadVideos(true);
    window.addEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);
    window.addEventListener("focus", refreshOnResume);
    window.addEventListener("online", refreshOnResume);
    document.addEventListener("visibilitychange", refreshOnResume);

    return () => {
      cancelled = true;
      requestSequence += 1;
      requestController?.abort();
      requestController = null;
      window.clearTimeout(refreshTimer);
      window.removeEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);
      window.removeEventListener("focus", refreshOnResume);
      window.removeEventListener("online", refreshOnResume);
      document.removeEventListener("visibilitychange", refreshOnResume);
    };
  }, [profileId, enabled]);
  return { uploadedVideos, setUploadedVideos, isMediaLoading, mediaError };
}
