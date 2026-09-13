/** A decoded frame alone does not mean a cellular connection has spare bandwidth. */
export function hasVideoWarmupBuffer(video: HTMLVideoElement | null | undefined) {
  if (!video || video.readyState < 2 || !Number.isFinite(video.duration)) return false;
  const position = video.currentTime;
  // Adaptive neighbors fetch only one small segment. A progressive neighbor
  // can request much more, so keep its larger three-second safety margin.
  const target = Math.min(video.duration, position + (video.dataset?.adaptiveUrl ? 1.5 : 3));
  for (let index = 0; index < video.buffered.length; index++) {
    if (video.buffered.start(index) <= position && video.buffered.end(index) >= target - .05) return true;
  }
  return false;
}

/** Notify only when buffer eligibility changes, without polling or React renders. */
export function observeVideoWarmup(video: HTMLVideoElement | null | undefined, onChange: () => void) {
  if (!video) return;
  let ready = hasVideoWarmupBuffer(video);
  const update = () => {
    const next = hasVideoWarmupBuffer(video);
    if (ready === next) return;
    ready = next;
    onChange();
  };
  const events = ["progress", "mydancrvideobufferchange", "loadeddata", "waiting", "emptied"];
  events.forEach((event) => video.addEventListener(event, update));
  return () => events.forEach((event) => video.removeEventListener(event, update));
}

/** Give startup exclusive bandwidth, then prepare two clips in each direction.
 * Retain attached neighbors during buffering; data saver keeps only the active source attached. */
export function videoBufferMode(
  index: number,
  activeIndex: number,
  allowWarmup: boolean,
  activeReady: boolean,
  hasSource: boolean,
) {
  if (index === activeIndex) return "auto";
  if (!allowWarmup) return "release";
  if (Math.abs(index - activeIndex) <= 2) return activeReady ? "auto" : hasSource ? "retain" : "release";
  return "release";
}

/** Prepare upcoming clips first; previously played clips usually already have data. */
export function videoWarmupOrder(activeIndex: number, length: number) {
  return [activeIndex, activeIndex + 1, activeIndex + 2, activeIndex - 1, activeIndex - 2]
    .filter((index) => index >= 0 && index < length);
}
