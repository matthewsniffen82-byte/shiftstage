"use client";
import { useEffect, useState } from "react";
import { readSession, requestDancerTvVideosJson } from "./dashboard-session";
import { DANCER_PROFILE_VIDEOS_CHANGED_EVENT } from "./dancer-profile-media-sync";
import type { DancerPreviewVideo } from "./dashboard-types";
export function useDancerProfileVideos(profileId: unknown) {
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [uploadedVideos, setUploadedVideos] = useState<DancerPreviewVideo[]>([]);
  useEffect(() => {
    if (!readSession()?.accessToken) {
      setIsMediaLoading(false);
      setUploadedVideos([]);
      setMediaError("Sign in again to load your saved profile videos.");
      return;
    }

    let cancelled = false;
    let refreshTimer = 0;
    let requestSequence = 0;
    let requestController: AbortController | null = null;
    const loadVideos = async (showLoading = false) => {
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
        setMediaError(error instanceof Error ? error.message : "Unable to load your saved profile videos.");
      } finally {
        if (requestController === controller) requestController = null;
        if (!cancelled && !controller.signal.aborted && requestId === requestSequence) setIsMediaLoading(false);
      }
    };
    const refreshAfterVideoChange = () => {
      window.clearTimeout(refreshTimer);
      void loadVideos();
    };

    setUploadedVideos([]);
    void loadVideos(true);
    window.addEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);

    return () => {
      cancelled = true;
      requestSequence += 1;
      requestController?.abort();
      requestController = null;
      window.clearTimeout(refreshTimer);
      window.removeEventListener(DANCER_PROFILE_VIDEOS_CHANGED_EVENT, refreshAfterVideoChange);
    };
  }, [profileId]);
  return { uploadedVideos, setUploadedVideos, isMediaLoading, mediaError };
}
