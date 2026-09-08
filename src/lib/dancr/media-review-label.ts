/** A profile's approval never substitutes for an individual upload's review. */
export function mediaReviewLabel(status: string, moderationStatus = "") {
  const state = String(status || "").trim().toLowerCase();
  if (state === "approved" || state === "live") return "Approved";
  if (state === "rejected" || state === "denied") return "Not approved";
  if (state === "uploading") return "Upload incomplete";
  if (state === "failed") return "Upload failed";
  if (state === "hidden" || state === "removed") return "Removed";
  if (state === "expired") return "Expired";
  const review = String(moderationStatus || state).trim().toLowerCase();
  if (["pending_review", "submitted", "review", "completed"].includes(review)) return "Awaiting review";
  if (["error", "moderation_error", "moderation_retry"].includes(review)) return "Review delayed";
  if (["pending", "moderating"].includes(state)) return "Checking";
  return "Check upload status";
}
