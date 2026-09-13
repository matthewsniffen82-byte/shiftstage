/** Give startup exclusive bandwidth, then preload the next clip and the second clip's metadata.
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
  if (index === activeIndex + 1) return activeReady ? "auto" : hasSource ? "retain" : "release";
  if (index === activeIndex + 2) return activeReady ? "metadata" : hasSource ? "retain" : "release";
  if (index === activeIndex - 1 && hasSource) return "retain";
  return "release";
}
