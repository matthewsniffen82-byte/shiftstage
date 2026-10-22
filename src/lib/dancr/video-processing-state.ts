// A worker finishes within four minutes; its lease expires after five.
export const VIDEO_PROCESSING_STALE_MS = 5 * 60_000;

type ProcessingVideo = {
  status: string;
  moderationStartedAt?: string | null;
  moderationAttemptCount?: number;
};

export function isVideoProcessingStalled(video: ProcessingVideo, now = Date.now()) {
  const started = Date.parse(video.moderationStartedAt || "");
  return video.status === "moderating" && Number.isFinite(started)
    && started < now - VIDEO_PROCESSING_STALE_MS;
}

export function canRecoverVideoProcessing(video: ProcessingVideo, now = Date.now()) {
  return video.status === "moderating"
    && (video.moderationAttemptCount === 0 || isVideoProcessingStalled(video, now));
}
