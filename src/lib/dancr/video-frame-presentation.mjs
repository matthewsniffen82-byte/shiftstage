/** Keep the poster until playback has submitted a frame and the browser has painted it.
 * @param {HTMLVideoElement} video
 */
export function observeVideoPresentation(video) {
  let videoFrame = 0;
  let paintFrame = 0;
  let generation = 0;

  function cancelPending() {
    generation += 1;
    if (videoFrame) video.cancelVideoFrameCallback(videoFrame);
    if (paintFrame) window.cancelAnimationFrame(paintFrame);
    videoFrame = 0;
    paintFrame = 0;
  }

  function reset() {
    cancelPending();
    delete video.dataset.frameReady;
  }

  function revealAfterPaint() {
    const pendingGeneration = generation;
    // A submitted frame can still be one display refresh ahead of its paint.
    paintFrame = window.requestAnimationFrame(() => {
      if (pendingGeneration !== generation) return;
      paintFrame = window.requestAnimationFrame(() => {
        if (pendingGeneration !== generation) return;
        paintFrame = 0;
        if (video.isConnected && !video.paused && !video.seeking && video.readyState >= 2) {
          video.dataset.frameReady = "true";
        }
      });
    });
  }

  function reveal() {
    if (video.dataset.frameReady === "true" || video.paused || video.seeking || videoFrame || paintFrame) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      const pendingGeneration = generation;
      videoFrame = video.requestVideoFrameCallback(() => {
        if (pendingGeneration !== generation) return;
        videoFrame = 0;
        revealAfterPaint();
      });
    } else if (video.readyState >= 2) {
      // Older browsers use actual playback plus two paint opportunities.
      revealAfterPaint();
    }
  }

  function startPlayback() {
    // A resumed iPhone player can recreate its display surface after being offscreen.
    reset();
    reveal();
  }

  video.addEventListener("play", startPlayback);
  video.addEventListener("playing", reveal);
  video.addEventListener("timeupdate", reveal);
  video.addEventListener("pause", cancelPending);
  video.addEventListener("loadstart", reset);
  video.addEventListener("emptied", reset);
  video.addEventListener("error", reset);
  if (!video.paused) reveal();
  return () => {
    cancelPending();
    video.removeEventListener("play", startPlayback);
    video.removeEventListener("playing", reveal);
    video.removeEventListener("timeupdate", reveal);
    video.removeEventListener("pause", cancelPending);
    video.removeEventListener("loadstart", reset);
    video.removeEventListener("emptied", reset);
    video.removeEventListener("error", reset);
  };
}
