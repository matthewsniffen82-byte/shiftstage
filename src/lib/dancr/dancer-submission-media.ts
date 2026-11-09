import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "./media-limits.ts";

export type OnboardingMediaSubmission = { ready: boolean; submitted: boolean };

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
  const videoCount = Number(profile?.onboarding_video_count || 0);
  return { count: keys.size, hasMain: keys.has("main"), videoCount: Number.isSafeInteger(videoCount) && videoCount > 0 ? videoCount : 0 };
}

/** Finished, checked profile uploads count while awaiting human approval. */
export function dancerSubmissionVideoCount(videos: Array<{ id?: unknown; status?: unknown; fileChecksPassed?: boolean; distributionScope?: string }>) {
  return new Set(videos.filter(video => video.id && video.distributionScope !== "feed_only" && (video.status === "approved"
    || (video.status === "submitted" && video.fileChecksPassed === true))).map(video => String(video.id))).size;
}

type MediaRequirementCounts = { photoCount: number; hasMain: boolean; videoCount: number; includeVideoRequirement?: boolean };

export function dancerMissingMedia({ photoCount, hasMain, videoCount, includeVideoRequirement = true, includeMainPhotoNote = true }: MediaRequirementCounts & { includeMainPhotoNote?: boolean }) {
  const photosNeeded = Math.max(0, MIN_DANCER_ONBOARDING_PHOTOS - photoCount);
  const videosNeeded = Math.max(0, MIN_DANCER_ONBOARDING_VIDEOS - videoCount);
  const mainPhotoNote = includeMainPhotoNote && !hasMain ? " (including your main photo)" : "";
  return {
    photos: photosNeeded ? `${photosNeeded}${photoCount ? " more" : ""} photo${photosNeeded === 1 ? "" : "s"}${mainPhotoNote}`
      : hasMain ? "" : "your main photo",
    videos: videosNeeded && includeVideoRequirement ? `${videosNeeded} video${videosNeeded === 1 ? "" : "s"}` : "",
  };
}

export function dancerMediaRequirementHint({ includeOptionalGuidance = true, compact = false, action = compact ? "none" : "submit", ...counts }: MediaRequirementCounts & {
  includeOptionalGuidance?: boolean; compact?: boolean; action?: "submit" | "continue" | "none";
}) {
  const { photos, videos } = dancerMissingMedia(counts);
  const missing = [photos, videos].filter(Boolean);
  const purpose = action === "continue" ? " to continue" : action === "submit" ? " to submit for approval" : "";
  const optionalGuidance = compact ? " Extras optional." : " Additional photos and videos are optional.";
  return missing.length ? `Add ${missing.join(" and ")}${purpose}.${includeOptionalGuidance ? optionalGuidance : ""}` : "";
}
