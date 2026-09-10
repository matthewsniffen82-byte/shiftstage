import type { ReviewStatus } from "./types";

export type ContentReviewVersion = {
  target: Record<string, unknown>;
  review: { id: string; status: ReviewStatus; reviewed_at: string | null } | null;
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const status = (value: unknown) => value === "pending" || value === "approved" || value === "rejected";
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function isContentReviewVersion(value: unknown, type: "photo" | "social_link"): value is ContentReviewVersion {
  if (!record(value) || !record(value.target) || !("review" in value)) return false;
  const target = value.target, review = value.review;
  if (review !== null && (!record(review) || typeof review.id !== "string" || !review.id
    || !status(review.status) || (review.reviewed_at !== null && !timestamp(review.reviewed_at)))) return false;
  return type === "photo"
    ? typeof target.storage_path === "string" && typeof target.is_primary === "boolean"
      && Number.isInteger(target.sort_order) && status(target.review_status)
    : typeof target.platform === "string" && typeof target.handle === "string" && typeof target.url === "string"
      && typeof target.is_active === "boolean" && timestamp(target.updated_at);
}

export function buildContentReviewVersion(type: "photo" | "social_link", target: Record<string, any>, review?: Record<string, any>): ContentReviewVersion {
  return {
    target: type === "photo"
      ? { storage_path: target.storage_path, is_primary: target.is_primary, sort_order: target.sort_order, review_status: target.review_status }
      : { platform: target.platform, handle: target.handle, url: target.url, is_active: target.is_active, updated_at: target.updated_at },
    review: review ? { id: review.id, status: review.status, reviewed_at: review.reviewed_at || null } : null,
  };
}
