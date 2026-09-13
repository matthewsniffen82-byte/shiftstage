/** Give startup exclusive bandwidth, then prepare playable neighbors in both directions.
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
  if (Math.abs(index - activeIndex) === 1) return activeReady ? "auto" : hasSource ? "retain" : "release";
  return "release";
}
