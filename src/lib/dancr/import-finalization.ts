import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

export const IMPORT_FINALIZATION_FIELDS = [
  "dancer_id", "submitted_by", "storage_path", "status", "review_notes", "reviewed_by",
  "submitted_at", "reviewed_at", "published_at", "updated_at", "moderation_started_at", "moderation_completed_at",
] as const;
const timestampFields = new Set<string>(["submitted_at", "reviewed_at", "published_at", "updated_at", "moderation_started_at", "moderation_completed_at"]);
const statuses = new Set(["moderating", "submitted", "approved", "rejected", "hidden", "expired"]);
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const unconfirmed = () => new PublicApiError("UNAVAILABLE", "Import finalization could not be confirmed. The video may already be published. Check this batch before retrying.", 503);

function timestamp(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})$/);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds) * BigInt(1000) + BigInt((match[1] || "").padEnd(6, "0").slice(3));
}

function validVersion(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === IMPORT_FINALIZATION_FIELDS.length
    && IMPORT_FINALIZATION_FIELDS.every(field => field in row)
    && uuid(row.dancer_id) && uuid(row.submitted_by) && (row.reviewed_by === null || uuid(row.reviewed_by))
    && typeof row.storage_path === "string" && row.storage_path.length > 0
    && typeof row.status === "string" && statuses.has(row.status)
    && (row.review_notes === null || typeof row.review_notes === "string")
    && [...timestampFields].every(field => row[field] === null ? field !== "updated_at" : timestamp(row[field]) !== null);
}

export async function recordImportFinalization(client: SupabaseClient, input: {
  adminId: string; videoId: string; batchId: string; snapshot: Record<string, unknown>;
}) {
  const expected = Object.fromEntries(IMPORT_FINALIZATION_FIELDS.map(field => [field, input.snapshot[field]]));
  if (input.snapshot.id !== input.videoId.toLowerCase() || !validVersion(expected)) throw unconfirmed();
  const { data, error } = await client.rpc("finalize_platform_import_safely", {
    p_admin_id: input.adminId, p_video_id: input.videoId, p_batch_id: input.batchId, p_expected: expected,
  });
  if (error) {
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "Admin access required.", 403);
    if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "This import video is no longer available. Check the batch.", 404);
    if (error.code === "40001") throw new PublicApiError("CONFLICT", "This video changed. Check the batch before finalizing it again.", 409);
    throw unconfirmed();
  }
  const marker = `platform-import:${input.batchId}:${expected.status}`;
  const previousNote = expected.review_notes as string | null;
  const note = previousNote?.split("\n")[0] === marker ? previousNote : marker + (previousNote ? "\n" + previousNote : "");
  if (!data || data.video_id !== input.videoId.toLowerCase() || data.batch_id !== input.batchId || data.status !== expected.status
    || !uuid(data.audit_id) || timestamp(data.recorded_at) === null || typeof data.already_recorded !== "boolean"
    || !validVersion(data.version) || data.version.review_notes !== note
    || IMPORT_FINALIZATION_FIELDS.some(field => field !== "review_notes" && (timestampFields.has(field)
      ? timestamp(data.version[field]) !== timestamp(expected[field])
      : data.version[field] !== expected[field]))) throw unconfirmed();
  return {
    videoId: data.video_id as string, status: data.status as string,
    auditId: data.audit_id as string, recordedAt: data.recorded_at as string, alreadyRecorded: data.already_recorded as boolean,
  };
}
