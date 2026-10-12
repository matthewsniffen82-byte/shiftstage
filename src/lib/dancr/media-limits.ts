export const MAX_DANCER_PROFILE_PHOTOS = 50;
/** The face/avatar image is separate from the public gallery. */
export const MIN_DANCER_ONBOARDING_PHOTOS = 3;

export function approvedProfilePhotoCount(photos: Array<{ id?: unknown; status?: unknown; review_status?: unknown }>) {
  return new Set(photos.filter(photo => (photo.review_status ?? photo.status) === "approved" && photo.id)
    .map(photo => String(photo.id))).size;
}
export const MAX_DANCER_PROFILE_VIDEOS = 50;
export const DANCER_PROFILE_MEDIA_PAGE_SIZE = 12;
