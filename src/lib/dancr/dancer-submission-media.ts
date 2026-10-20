/** Pending uploads unlock verification; only approved media unlocks publication. */
export function dancerSubmissionMedia(profile: Record<string, unknown> | null | undefined) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos : [];
  const pending = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews : [];
  const accepted = photos.filter(photo => photo.review_status === "approved");
  const approvedIds = new Set(accepted.map(photo => String(photo.id)));
  const keys = new Set<string>(accepted.map(photo => photo.is_primary ? "main" : String(photo.id)));
  for (const review of pending) {
    if (!review.id || review.decision === "rejected" || review.status === "rejected") continue;
    const context = String(review.upload_context || "");
    if (!/^profile_(main|gallery)(:|$)/.test(context)) continue;
    if (review.photo_publication_mode === "replace" && approvedIds.has(String(review.replacement_photo_id))) continue;
    keys.add(context.startsWith("profile_main") ? "main" : review.photo_publication_mode === "replace"
      ? `replacement:${review.replacement_photo_id}` : String(review.id));
  }
  return { count: keys.size, hasMain: keys.has("main") };
}
