/** Keep one upcoming clip warm and reuse the previous player without loading
 * an unseen previous clip. Data saver keeps only the active source attached. */
export function videoBufferMode(
  index: number,
  activeIndex: number,
  allowWarmup: boolean,
  activeReady: boolean,
  hasSource: boolean,
) {
  if (index === activeIndex) return "auto";
  if (!allowWarmup) return "release";
  if (index === activeIndex + 1) return activeReady ? "auto" : "metadata";
  if (index === activeIndex - 1 && hasSource) return "retain";
  return "release";
}
