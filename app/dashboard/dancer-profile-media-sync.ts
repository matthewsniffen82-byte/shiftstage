export const DANCER_PROFILE_VIDEOS_CHANGED_EVENT = "mydancr:dancer-profile-videos-changed";

export function announceDancerProfileVideosChanged() {
  window.dispatchEvent(new Event(DANCER_PROFILE_VIDEOS_CHANGED_EVENT));
}

export function primeVideoPreviewFrame(video: HTMLVideoElement) {
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime > 0) return;
  try {
    video.currentTime = Math.min(0.15, Math.max(0.05, video.duration / 100));
  } catch {
    // Some mobile browsers delay seeking until they have buffered a frame.
  }
}
