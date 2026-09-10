export const PROFILE_REVIEW_FIELDS = [
  "user_id", "stage_name", "city", "status", "verification_status", "photo_review_status",
  "avatar_storage_path", "is_public", "approved_at", "disabled_at", "admin_disabled_at", "venue_approved_at",
  "venue_approved_by_user_id", "venue_approved_venue_id", "updated_at",
] as const;
export type ProfileReviewVersion = Record<typeof PROFILE_REVIEW_FIELDS[number], unknown>;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const reviewStatus = (value: unknown) => value === "pending" || value === "approved" || value === "rejected";

export function isProfileReviewVersion(value: unknown): value is ProfileReviewVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === PROFILE_REVIEW_FIELDS.length && PROFILE_REVIEW_FIELDS.every(key => key in row)
    && uuid(row.user_id) && typeof row.stage_name === "string" && typeof row.city === "string"
    && typeof row.status === "string" && ["draft", "pending_review", "approved", "rejected", "disabled"].includes(row.status)
    && reviewStatus(row.verification_status) && reviewStatus(row.photo_review_status)
    && (row.avatar_storage_path === null || typeof row.avatar_storage_path === "string") && typeof row.is_public === "boolean"
    && ["approved_at", "disabled_at", "admin_disabled_at", "venue_approved_at"].every(key => row[key] === null || date(row[key]))
    && ["venue_approved_by_user_id", "venue_approved_venue_id"].every(key => row[key] === null || uuid(row[key])) && date(row.updated_at);
}

export function buildProfileReviewVersion(row: Record<string, unknown>): ProfileReviewVersion {
  return Object.fromEntries(PROFILE_REVIEW_FIELDS.map(key => [key, row[key]])) as ProfileReviewVersion;
}
