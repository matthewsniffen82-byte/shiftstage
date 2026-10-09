import { mediaReviewLabel } from "../../src/lib/dancr/media-review-label.ts";

export type AvatarUploadState = "checking" | "pending" | "approved" | "rejected" | "failed";

export type AvatarUploadFeedback = {
  state: AvatarUploadState;
  message?: string;
  reviewId?: string;
  moderationStatus?: string;
};

export const AVATAR_REJECTED_MESSAGE = "Avatar not approved. Choose a clear solo face photo of yourself.";

export function avatarUploadPresentation({
  upload,
  avatarUrl,
  pendingReview,
  latestReview,
}: {
  upload: AvatarUploadFeedback | null;
  avatarUrl: string;
  pendingReview?: Record<string, unknown> | null;
  latestReview?: Record<string, unknown> | null;
}) {
  let state = upload?.state;
  let message = upload?.message || "";
  const matchingReview = !upload || (upload.state === "pending" && upload.reviewId === latestReview?.id);
  if (matchingReview) {
    if (latestReview?.decision === "rejected") {
      state = !upload && avatarUrl ? "approved" : "rejected";
      message = !upload && avatarUrl
        ? "New avatar not approved. Your approved avatar is still in use."
        : AVATAR_REJECTED_MESSAGE;
    } else if (pendingReview) {
      state = "pending";
    } else if (avatarUrl && latestReview?.decision === "approved") {
      state = "approved";
    }
  }
  if (!state) state = avatarUrl ? "approved" : undefined;
  const reviewStatus = String(pendingReview?.status || upload?.moderationStatus || "pending_review");
  const label = state === "checking" ? "Checking"
    : state === "pending" ? mediaReviewLabel("pending", reviewStatus)
    : state === "rejected" ? "Not approved"
    : state === "failed" ? "Not uploaded"
    : state === "approved" ? "Approved" : "Required";
  return { state, label, message, canRetry: state === "failed" };
}
