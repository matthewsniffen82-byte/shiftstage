/** Give startup exclusive bandwidth, then preload one clip strongly and a second lightly in both directions.
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
  const distance = Math.abs(index - activeIndex);
  if (distance === 1) return activeReady ? "auto" : hasSource ? "retain" : "release";
  if (distance === 2) return activeReady ? "metadata" : hasSource ? "retain" : "release";
  return "release";
}
