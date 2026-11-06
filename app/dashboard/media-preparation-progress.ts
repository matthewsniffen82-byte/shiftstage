/** Transfer bytes are measured; the remaining processing time is estimated. */
export function mediaPreparationPercent({ processing, transferProgress = 0, elapsedMs = 0, kind }: {
  processing: boolean;
  transferProgress?: number;
  elapsedMs?: number;
  kind: "photo" | "video";
}) {
  if (!processing) {
    const transferred = Number.isFinite(transferProgress) ? Math.max(0, Math.min(100, transferProgress)) : 0;
    return Math.floor(transferred * 0.7);
  }
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const timeScale = kind === "video" ? 45_000 : 12_000;
  // Only a confirmed ready state may replace this estimate with Ready to submit.
  return Math.min(99, 70 + Math.floor(30 * (1 - Math.exp(-elapsed / timeScale))));
}

export function isMediaProcessing(item: { status: string; moderationStatus?: string }) {
  if (["error", "moderation_error", "moderation_retry"].includes(item.moderationStatus || "")) return false;
  return item.status === "moderating"
    || item.status === "pending" && ["pending", "moderating"].includes(item.moderationStatus || "");
}
