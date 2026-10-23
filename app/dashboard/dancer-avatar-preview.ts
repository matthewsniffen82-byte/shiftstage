export function dancerAvatarPreview(profile: Record<string, unknown> | null | undefined, pendingMainId?: string) {
  const pendingReview = (Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [])
    .find((review: Record<string, unknown>) => review.id === pendingMainId && review.status === "pending_review");
  const pendingAvatarUrl = typeof pendingReview?.avatarPreviewUrl === "string" ? pendingReview.avatarPreviewUrl : "";
  return {
    pendingAvatarUrl,
    avatarUrl: pendingAvatarUrl || String(profile?.avatarPhotoUrl || ""),
    objectPosition: pendingAvatarUrl ? "50% 50%" : `${profile?.avatarPhotoFocalX ?? 50}% ${profile?.avatarPhotoFocalY ?? 50}%`,
  };
}
