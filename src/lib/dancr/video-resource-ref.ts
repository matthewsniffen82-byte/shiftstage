// A loaded buffer does not guarantee that mobile browsers have painted a frame.
// Keep the independent poster until playback submits its first frame.
export function watchVideoPosterPresentation(video: HTMLVideoElement) {
  let frame: number | null = null;
  let paint: number | null = null;
  let generation = 0;
  const cancel = () => {
    generation++;
    if (frame !== null) video.cancelVideoFrameCallback(frame);
    if (paint !== null) window.cancelAnimationFrame(paint);
    frame = null;
    paint = null;
  };
  const reset = () => {
    cancel();
    delete video.dataset.frameReady;
  };
  const reveal = () => {
    if (video.dataset.frameReady === "true" || frame !== null || paint !== null) return;
    const source = video.getAttribute("src");
    if (!source) return;
    const version = generation;
    const ready = () => video.isConnected && generation === version &&
      video.getAttribute("src") === source && video.readyState >= 2;
    if (typeof video.requestVideoFrameCallback === "function") {
      frame = video.requestVideoFrameCallback(() => {
        if (generation !== version) return;
        frame = null;
        if (ready()) video.dataset.frameReady = "true";
      });
    } else {
      // Older browsers: allow a paint after the native playing event, never
      // reveal a merely preloaded or autoplay-blocked player.
      paint = window.requestAnimationFrame(() => {
        if (generation !== version) return;
        paint = window.requestAnimationFrame(() => {
          if (generation !== version) return;
          paint = null;
          if (ready() && !video.paused) video.dataset.frameReady = "true";
        });
      });
    }
  };
  video.addEventListener("playing", reveal);
  video.addEventListener("emptied", reset);
  video.addEventListener("error", reset);
  return () => {
    reset();
    video.removeEventListener("playing", reveal);
    video.removeEventListener("emptied", reset);
    video.removeEventListener("error", reset);
  };
}

// React 19 calls this stable ref's cleanup when its video leaves the DOM.
// Capture the element: object refs can already be null during effect cleanup.
export function videoResourceRef(video: HTMLVideoElement | null) {
  if (!video) return;
  const clearPosterPresentation = watchVideoPosterPresentation(video);
  return () => {
    clearPosterPresentation();
    video.pause();
    video.preload = "none";
    delete video.dataset.frameReady;
    if (video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  };
}
