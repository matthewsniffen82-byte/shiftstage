import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { galleryReviewVersion } from "./photo-publication";

export type AvatarSnapshot = { avatar_storage_path: string | null; avatar_updated_at: string | null };
type Owner = { userId: string; profileId: string };
type AvatarProfile = AvatarSnapshot & { id: string; user_id: string };
type AvatarReview = Record<string, any> & { id: string; user_id: string; updated_at: string };

export function avatarConflict() {
  return new PublicApiError("CONFLICT", "This avatar or its review has changed. Refresh your profile before trying again.", 409);
}
function unconfirmed() {
  return new PublicApiError("UNAVAILABLE", "The avatar change could not be confirmed. Refresh your profile before trying again.", 503);
}
function nullableVersion(value: unknown): string | null {
  return value === null ? null : galleryReviewVersion(value);
}
export function isOwnedAvatarMediaPath(path: unknown, owner: Owner): path is string {
  return typeof path === "string" && path.startsWith(`${owner.userId}/${owner.profileId}/`)
    && path.length <= 1024 && path === path.trim() && !path.split("/").includes("..");
}
function checkedProfile(value: any, owner: Owner): AvatarProfile {
  if (!value || value.id !== owner.profileId || value.user_id !== owner.userId
    || !(value.avatar_storage_path === null || typeof value.avatar_storage_path === "string")
    || typeof value.avatar_updated_at !== "string" || !Number.isFinite(Date.parse(value.avatar_updated_at))) throw unconfirmed();
  return value;
}
async function avatarRpc(client: SupabaseClient, name: string, args: Record<string, unknown>, preserveDuplicate = false) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (preserveDuplicate && error.code === "23505") throw error;
    if (["40001", "23505", "P0002", "54000"].includes(error.code)) throw avatarConflict();
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "This account cannot change this avatar.", 403);
    throw error;
  }
  return data;
}

/** Reserve the original identity snapshot and review in one transaction. */
export async function createDancerAvatarReview(client: SupabaseClient, input: Owner & {
  expected: AvatarSnapshot; temporaryStoragePath: string; idempotencyKey: string; providerModel: string;
}): Promise<AvatarReview> {
  const data = await avatarRpc(client, "create_dancer_avatar_review", {
    p_user_id: input.userId, p_profile_id: input.profileId,
    p_expected_avatar_path: input.expected.avatar_storage_path,
    p_expected_avatar_updated_at: nullableVersion(input.expected.avatar_updated_at),
    p_temporary_storage_path: input.temporaryStoragePath, p_idempotency_key: input.idempotencyKey,
    p_provider_model: input.providerModel,
  }, true);
  const profile = checkedProfile(data?.profile, input), record = data?.record;
  if (!record || typeof record.id !== "string" || !record.id || record.user_id !== input.userId
    || record.upload_context !== "profile_avatar" || record.image_id !== null
    || record.status !== "moderating" || record.decision !== "review" || record.attempt_count !== 1
    || record.temporary_storage_path !== input.temporaryStoragePath || record.idempotency_key !== input.idempotencyKey
    || record.avatar_expected_path !== profile.avatar_storage_path
    || profile.avatar_storage_path !== input.expected.avatar_storage_path
    || record.avatar_expected_updated_at !== profile.avatar_updated_at
    || typeof record.updated_at !== "string" || !Number.isFinite(Date.parse(record.updated_at))) throw unconfirmed();
  return record;
}

/** Retries keep the persisted upload intent; they never adopt the latest avatar. */
export function avatarRetryReference(record: AvatarReview, profile: AvatarSnapshot): string | null {
  if (record.avatar_expected_updated_at == null
    || galleryReviewVersion(record.avatar_expected_updated_at) !== profile.avatar_updated_at
    || record.avatar_expected_path !== profile.avatar_storage_path) throw avatarConflict();
  return record.avatar_expected_path;
}

export async function publishDancerAvatar(client: SupabaseClient, input: Owner & {
  recordId: string; expectedUpdatedAt: unknown; storagePath: string; reasonCodes: unknown[];
  categoryFlags: Record<string, unknown>; categoryScores: Record<string, unknown>; providerFlagged: boolean;
  reviewerId?: string; reviewNotes?: string; legacyExpected?: AvatarSnapshot;
}) {
  const data = await avatarRpc(client, "publish_approved_dancer_avatar", {
    p_record_id: input.recordId, p_expected_updated_at: galleryReviewVersion(input.expectedUpdatedAt),
    p_storage_path: input.storagePath, p_reason_codes: input.reasonCodes,
    p_category_flags: input.categoryFlags, p_category_scores: input.categoryScores, p_provider_flagged: input.providerFlagged,
    p_reviewer_id: input.reviewerId ?? null, p_review_notes: input.reviewNotes ?? null,
    p_legacy_avatar_path: input.legacyExpected?.avatar_storage_path ?? null,
    p_legacy_avatar_updated_at: input.legacyExpected ? nullableVersion(input.legacyExpected.avatar_updated_at) : null,
  });
  const profile = checkedProfile(data?.profile, input), record = data?.record;
  if (!record || record.id !== input.recordId || record.user_id !== input.userId || record.image_id !== null
    || record.upload_context !== "profile_avatar" || record.decision !== "approved" || record.status !== "approved"
    || typeof record.updated_at !== "string" || !Number.isFinite(Date.parse(record.updated_at))
    || !profile.avatar_storage_path || record.final_storage_path !== profile.avatar_storage_path
    || typeof data.already_published !== "boolean"
    || (!data.already_published && profile.avatar_storage_path !== input.storagePath)
    || !(data.previous_storage_path === null || typeof data.previous_storage_path === "string")
    || (data.already_published && data.previous_storage_path !== null)) throw unconfirmed();
  return { profile, record: record as AvatarReview, previousStoragePath: data.previous_storage_path as string | null,
    alreadyPublished: data.already_published as boolean };
}

/** Return only checked, committed deletions; callers retain every byte on uncertainty. */
export async function clearDancerAvatar(client: SupabaseClient, input: Owner & { expected: AvatarSnapshot }) {
  const data = await avatarRpc(client, "clear_dancer_avatar_safely", {
    p_user_id: input.userId, p_profile_id: input.profileId, p_expected_avatar_path: input.expected.avatar_storage_path,
    p_expected_avatar_updated_at: nullableVersion(input.expected.avatar_updated_at),
  });
  const profile = checkedProfile(data?.profile, input), records = data?.deleted_records;
  if (profile.avatar_storage_path !== null || data.previous_storage_path !== input.expected.avatar_storage_path
    || !Array.isArray(records) || records.length > 1000
    || records.some((r: any) => !r || typeof r.id !== "string" || !r.id || r.user_id !== input.userId
      || !(r.temporary_storage_path === null || typeof r.temporary_storage_path === "string")
      || !(r.final_storage_path === null || typeof r.final_storage_path === "string"))
    || new Set(records.map((r: any) => r.id)).size !== records.length) throw unconfirmed();
  return { profile, records: records as { id: string; user_id: string; temporary_storage_path: string | null; final_storage_path: string | null }[],
    previousStoragePath: data.previous_storage_path as string | null };
}

export async function recenterDancerAvatar(client: SupabaseClient, input: Owner & {
  expected: AvatarSnapshot; reviewerId: string; storagePath: string; sourcePath: string; sourcePhotoId: string | null;
}) {
  const data = await avatarRpc(client, "recenter_dancer_avatar_safely", {
    p_reviewer_id: input.reviewerId, p_profile_id: input.profileId,
    p_expected_avatar_path: input.expected.avatar_storage_path,
    p_expected_avatar_updated_at: nullableVersion(input.expected.avatar_updated_at),
    p_storage_path: input.storagePath, p_source_path: input.sourcePath, p_source_photo_id: input.sourcePhotoId,
  });
  const profile = checkedProfile(data?.profile, input);
  if (profile.avatar_storage_path !== input.storagePath || data.previous_storage_path !== input.expected.avatar_storage_path) throw unconfirmed();
  return { profile, previousStoragePath: data.previous_storage_path as string | null };
}
