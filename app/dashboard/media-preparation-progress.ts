/** Keep the upload indicator visible until server preparation has finished. */
export function isMediaProcessing(item: { status: string; moderationStatus?: string }) {
  if (["error", "moderation_error", "moderation_retry"].includes(item.moderationStatus || "")) return false;
  return item.status === "moderating"
    || item.status === "pending" && ["pending", "moderating"].includes(item.moderationStatus || "");
}
