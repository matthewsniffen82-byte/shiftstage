type PublicVideo = { videoUrl?: string; mobilePlaybackAvailable?: boolean };

/** Select only an existing derivative on the same revocable media endpoint. */
export function publicVideoPlaybackUrl(item: PublicVideo) {
  const original = String(item?.videoUrl || "").trim();
  if (typeof window === "undefined" || item?.mobilePlaybackAvailable !== true
    || !/Android|iPhone/i.test(navigator.userAgent || "")
    || !window.matchMedia("(max-width: 760px)").matches) return original;
  try {
    const url = new URL(original, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== "/api/media/dancer-video" || !url.searchParams.get("id")) return original;
    url.searchParams.set("playback", "mobile");
    return url.href;
  } catch { return original; }
}

/** Retry once with the original, retaining position; the caller owns playback. */
export function fallbackPublicVideoSource(video: HTMLVideoElement) {
  const fullVideoUrl = video.dataset.fullVideoUrl;
  if (!fullVideoUrl || video.dataset.videoUrl === fullVideoUrl || !video.hasAttribute("src")) return false;
  const position = video.currentTime;
  video.dataset.videoUrl = fullVideoUrl;
  delete video.dataset.frameReady;
  if (Number.isFinite(position) && position > 0) {
    video.addEventListener("loadedmetadata", () => {
      if (video.dataset.videoUrl === fullVideoUrl && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(position, Math.max(0, video.duration - .1));
      }
    }, { once: true });
  }
  video.src = fullVideoUrl;
  return true;
}
