"use client";
import { useEffect, useState } from "react";
import { readSession, requestDancerTvVideosJson } from "./dashboard-session";
import { DANCER_PROFILE_VIDEOS_CHANGED_EVENT } from "./dancer-profile-media-sync";
import type { DancerPreviewVideo } from "./dashboard-types";
import { videoReviewStatus } from "@/src/lib/dancr/media-review-label";
import { isVideoProcessingStalled } from "@/src/lib/dancr/video-processing-state";
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
    let refreshAfterCurrent = false;
    const loadVideos = async (showLoading = false) => {
      // Media-change events can arrive while a slow status read is still running.
      // Finish it, then refresh once, instead of repeatedly canceling its response.
      if (requestController) { refreshAfterCurrent = true; return; }
      window.clearTimeout(refreshTimer);
      const requestId = ++requestSequence;
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
          const savedStatus = String(video?.status || "").toLowerCase();
          const status = savedStatus === "submitted" && video.uploadValidationPending === true ? "moderating" : savedStatus;
          if (!id || status === "hidden" || status === "removed" || status === "expired") return [];
          const fileChecksPassed = status === "approved" || (video.uploadValidationPending !== true && (video.moderationDetails as Record<string, unknown> | undefined)?.fileChecksPassed === true);
          return [{
            id,
            status,
            fileChecksPassed,
            moderationStatus: isVideoProcessingStalled({ status, moderationStartedAt: String(video.moderationStartedAt || "") })
              ? "moderation_error" : videoReviewStatus(status, null, String(video.clubReviewedAt || ""), fileChecksPassed),
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
          return status === "uploading" || status === "moderating" || status === "submitted" && video.uploadValidationPending === true;
        });
        const hasReviewVideo = savedVideos.some((video: Record<string, unknown>) => video.status === "submitted");
        window.clearTimeout(refreshTimer);
        if (hasProcessingVideo || hasReviewVideo) {
          refreshTimer = window.setTimeout(() => void loadVideos(), hasProcessingVideo ? 1_800 : 8_000);
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted || requestId !== requestSequence) return;
        const status = Number((error as { status?: number } | null)?.status);
        const retry = status !== 401 && status !== 403 && failures < 3;
        const timedOut = status === 408 || status === 504;
        setMediaError(timedOut ? retry ? "Video status is taking longer to refresh. Retrying automatically…"
          : "Unable to refresh video status. Check your connection and try again."
          : error instanceof Error ? error.message : "Unable to load your saved profile videos.");
        if (status === 401 || status === 403) refreshAfterCurrent = false;
        if (retry) {
          const delay = Math.min(8_000, 2_000 * 2 ** failures++);
          refreshTimer = window.setTimeout(() => {
            if (document.visibilityState === "visible") void loadVideos(true);
          }, delay);
        }
      } finally {
        if (requestController === controller) requestController = null;
        if (!cancelled && !controller.signal.aborted && requestId === requestSequence) setIsMediaLoading(false);
        if (!cancelled && refreshAfterCurrent) { refreshAfterCurrent = false; void loadVideos(); }
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
