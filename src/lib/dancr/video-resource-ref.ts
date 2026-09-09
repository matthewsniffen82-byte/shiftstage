// React 19 calls this stable ref's cleanup when its video leaves the DOM.
// Capture the element: object refs can already be null during effect cleanup.
export function videoResourceRef(video: HTMLVideoElement | null) {
  if (!video) return;
  return () => {
    video.pause();
    video.preload = "none";
    delete video.dataset.frameReady;
    if (video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  };
}
