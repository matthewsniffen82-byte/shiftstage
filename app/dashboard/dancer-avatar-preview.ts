export function dancerAvatarPreview(profile: Record<string, unknown> | null | undefined, pendingMainId?: string) {
  const reviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [];
  const pendingMain = pendingMainId
    ? reviews.find((review: Record<string, unknown>) => review.id === pendingMainId)
    : reviews.find((review: Record<string, unknown>) => review.is_primary || review.isPrimary || String(review.upload_context || "").includes("main"));
  const pendingReview = pendingMain?.status === "pending_review" ? pendingMain : undefined;
  const pendingAvatarUrl = typeof pendingReview?.avatarPreviewUrl === "string" ? pendingReview.avatarPreviewUrl : "";
  return {
    pendingAvatarUrl,
    avatarUrl: pendingAvatarUrl || String(profile?.avatarPhotoUrl || ""),
    objectPosition: pendingAvatarUrl ? "50% 50%" : `${profile?.avatarPhotoFocalX ?? 50}% ${profile?.avatarPhotoFocalY ?? 50}%`,
  };
}
