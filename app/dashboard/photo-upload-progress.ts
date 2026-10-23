type PhotoResult = { status: string; moderationStatus?: string };
type PhotoTransfer = { stage: string; progress?: number; error?: string };

/** Track file transfer only. Processing and final approval use status text. */
export function photoUploadPercent(item?: PhotoTransfer, result?: PhotoResult) {
  if (result) return ["approved", "rejected", "pending"].includes(result.status) ? 100 : 0;
  if (item?.stage === "checking") return 100;
  if (item?.stage === "uploading") {
    return Math.floor(Math.max(0, Math.min(100, Number.isFinite(item.progress) ? item.progress! : 0)));
  }
  return 0;
}

export function photoBatchProgress(entries: { item?: PhotoTransfer; result?: PhotoResult }[]) {
  if (!entries.length) return null;
  const percentages = entries.map(({ item, result }) => photoUploadPercent(item, result));
  return {
    percent: Math.floor(percentages.reduce((sum, percent) => sum + percent, 0) / entries.length),
    completed: percentages.filter(percent => percent === 100).length,
    total: entries.length,
    needsAttention: entries.some(({ item, result }) => Boolean(item?.error)
      || ["error", "moderation_error", "moderation_retry"].includes(result?.moderationStatus || "")),
  };
}
