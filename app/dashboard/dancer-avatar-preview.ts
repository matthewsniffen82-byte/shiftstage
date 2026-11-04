export function dancerAvatarPreview(profile: Record<string, unknown> | null | undefined, pendingMainId?: string) {
  const reviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [];
  const pendingMain = pendingMainId
    ? reviews.find((review: Record<string, unknown>) => review.id === pendingMainId)
    : reviews.find((review: Record<string, unknown>) => review.is_primary || review.isPrimary || String(review.upload_context || "").includes("main"));
  const pendingReview = pendingMain?.status === "pending_review" ? pendingMain : undefined;
  const generatedAvatarUrl = typeof pendingReview?.avatarPreviewUrl === "string" ? pendingReview.avatarPreviewUrl : "";
  const activeMain = ["pending", "moderating", "pending_review", "moderation_retry", "moderation_error"].includes(pendingMain?.status) ? pendingMain : undefined;
  // The owner already sees this private main-photo preview. Use it in the circle
  // until the face crop arrives, without changing any published avatar reference.
  const mainPreviewUrl = typeof activeMain?.previewUrl === "string" ? activeMain.previewUrl : "";
  const pendingAvatarUrl = generatedAvatarUrl || mainPreviewUrl;
  const needsAvatarRefresh = Boolean(activeMain && (["pending", "moderating"].includes(activeMain.status)
    || activeMain.status === "pending_review" && activeMain.category_flags?.publication_prepared === true && !generatedAvatarUrl));
  return {
    pendingAvatarUrl,
    needsAvatarRefresh,
    avatarUrl: pendingAvatarUrl || String(profile?.avatarPhotoUrl || ""),
    objectPosition: generatedAvatarUrl ? "50% 50%" : mainPreviewUrl ? "50% 25%" : `${profile?.avatarPhotoFocalX ?? 50}% ${profile?.avatarPhotoFocalY ?? 50}%`,
  };
}
