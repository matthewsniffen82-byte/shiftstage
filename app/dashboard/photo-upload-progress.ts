import { isAwaitingClubApproval } from "../../src/lib/dancr/media-review-label.ts";

type PhotoResult = { status: string; moderationStatus?: string };
type PhotoTransfer = { stage: string; progress?: number; error?: string };

/** Work milestones, not an elapsed-time estimate: transfer 0–90, receipt 95,
 * final processing result 100. Club approval is a separate human action. */
export function photoUploadPercent(item?: PhotoTransfer, result?: PhotoResult) {
  if (result) {
    if (["approved", "rejected"].includes(result.status)
      || isAwaitingClubApproval(result.status, result.moderationStatus)) return 100;
    return 95;
  }
  if (item?.stage === "checking") return 90;
  if (item?.stage === "uploading") {
    return Math.floor(Math.max(0, Math.min(100, Number.isFinite(item.progress) ? item.progress! : 0)) * .9);
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
