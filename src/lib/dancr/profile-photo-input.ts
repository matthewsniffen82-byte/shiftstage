import { PublicApiError } from "../api-error-policy.ts";
import { MAX_DANCER_PROFILE_PHOTOS } from "./media-limits.ts";

// A save can acknowledge both published photos and pending moderation records.
export const MAX_PROFILE_PHOTO_DELETIONS = MAX_DANCER_PROFILE_PHOTOS * 2;
const MAX_DELETED_PHOTO_PATHS = MAX_PROFILE_PHOTO_DELETIONS * 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateProfilePhotoDeletionInput(body: Record<string, unknown>) {
  const ids = readArray(body.deletedPhotoIds, MAX_PROFILE_PHOTO_DELETIONS, "photo deletions");
  for (const id of ids) {
    if (typeof id !== "string" || !UUID_PATTERN.test(id.trim())) {
      throw invalid("Each photo deletion must include a valid photo ID.");
    }
  }
  const paths = readArray(body.deletedPhotoStoragePaths, MAX_DELETED_PHOTO_PATHS, "deleted photo references");
  for (const path of paths) {
    if (typeof path !== "string" || !path.trim() || path.length > 4_096) {
      throw invalid("A deleted photo reference is invalid or too long.");
    }
  }
}

function readArray(value: unknown, max: number, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`Provide ${label} as a list.`);
  if (value.length > max) throw invalid(`A profile save supports up to ${max} ${label}.`);
  return value;
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}
