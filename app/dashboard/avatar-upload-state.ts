export type AvatarUploadState = "checking" | "pending" | "approved" | "rejected" | "failed";

export type AvatarUploadFeedback = {
  state: AvatarUploadState;
  message?: string;
  reviewId?: string;
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
      message = "Your avatar is waiting for approval. You don’t need to upload it again.";
    } else if (avatarUrl && latestReview?.decision === "approved") {
      state = "approved";
      message = "Avatar approved and saved.";
    }
  }
  if (!state) state = avatarUrl ? "approved" : undefined;
  const label = state === "checking" || state === "pending" ? "Checking"
    : state === "rejected" ? "Not approved"
    : state === "failed" ? "Not uploaded"
    : state === "approved" ? "Approved" : "Required";
  return { state, label, message, canRetry: state === "failed" };
}
