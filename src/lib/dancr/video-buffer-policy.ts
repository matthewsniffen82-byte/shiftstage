/** Give startup exclusive bandwidth, then warm metadata for one upcoming clip.
 * Reuse the previous player; data saver keeps only the active source attached. */
export function videoBufferMode(
  index: number,
  activeIndex: number,
  allowWarmup: boolean,
  activeReady: boolean,
  hasSource: boolean,
) {
  if (index === activeIndex) return "auto";
  if (!allowWarmup) return "release";
  if (index === activeIndex + 1) return activeReady ? "metadata" : "release";
  if (index === activeIndex - 1 && hasSource) return "retain";
  return "release";
}
