import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { processImageModerationRetryRecord } from "@/src/lib/dancr/image-moderation";
import { galleryReviewVersion } from "@/src/lib/dancr/photo-publication";
import { MODERATION_JOB_TIMEOUT_MS, MODERATION_WORKER_STALE_MS, runWithServerJob, serverJobRemainingMs } from "@/src/lib/server-job";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOBS_PER_RUN = 5;
const MAX_ATTEMPTS = 4;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminSupabaseClient() as any;
  try {
    return await runWithServerJob(async () => {
      const now = new Date().toISOString();
      const staleBefore = new Date(Date.now() - MODERATION_WORKER_STALE_MS).toISOString();
      const [retry, stale] = await Promise.all([
        admin.from("image_moderation_records").select("*", { count: "exact" })
          .eq("decision", "review").is("review_decision", null)
          .in("status", ["moderation_retry", "error"])
          .gte("attempt_count", 0)
          .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
          .order("next_attempt_at", { ascending: true, nullsFirst: true }).limit(MAX_JOBS_PER_RUN),
        admin.from("image_moderation_records").select("*", { count: "exact" })
          .eq("decision", "review").is("review_decision", null).eq("status", "moderating")
          .gte("attempt_count", 0)
          .lt("updated_at", staleBefore).or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
          .order("updated_at", { ascending: true }).limit(MAX_JOBS_PER_RUN),
      ]);
      if (retry.error) throw retry.error;
      if (stale.error) throw stale.error;
      const records = [...(retry.data || []), ...(stale.data || [])]
        .sort((a, b) => Date.parse(a.next_attempt_at || a.updated_at) - Date.parse(b.next_attempt_at || b.updated_at))
        .slice(0, MAX_JOBS_PER_RUN);

      const results = [];
      for (const record of records) {
        if (serverJobRemainingMs() < MODERATION_JOB_TIMEOUT_MS) break;
        try {
          const claimed = await claimRetryRecord(admin, record);
          if (!claimed) continue;
          if (claimed.status === "moderation_error") {
            results.push({ recordId: claimed.id, decision: "moderation_error", ok: true });
            continue;
          }
          const result = await processImageModerationRetryRecord(admin, claimed);
          results.push({ recordId: claimed.id, decision: result.decision, ok: true });
        } catch (error) {
          console.error("IMAGE_MODERATION_RETRY_WORKER_FAILED", {
            moderationRecordId: record.id, ...safeErrorMetadata(error),
          });
          results.push({ recordId: record.id, ok: false });
        }
      }
      const eligibleAtStart = Number.isSafeInteger(retry.count) && Number.isSafeInteger(stale.count)
        ? retry.count + stale.count : null;
      const failed = results.filter(result => !result.ok).length;
      console.info("IMAGE_MODERATION_RECOVERY_COMPLETED", { eligibleAtStart, processed: results.length, failed });
      return NextResponse.json({ ok: failed === 0, eligibleAtStart, processed: results.length, failed, results }, { status: failed ? 500 : 200 });
    }, 50_000);
  } catch (error) {
    console.error("IMAGE_MODERATION_RETRY_CRON_FAILED", safeErrorMetadata(error));
    return NextResponse.json({ ok: false, error: "Image moderation retry worker failed." }, { status: 500 });
  }
}

async function claimRetryRecord(admin: any, record: any) {
  const version = galleryReviewVersion(record.updated_at);
  const attempt = record.attempt_count;
  const now = Date.now();
  const staleBefore = now - MODERATION_WORKER_STALE_MS;
  if (!Number.isSafeInteger(attempt) || attempt < 0
    || record.decision !== "review" || record.review_decision !== null) return null;
  if (record.status === "moderating") {
    if (!(Date.parse(version) < staleBefore)
      || !(record.locked_at === null || Date.parse(record.locked_at) < staleBefore)) return null;
  } else if (!["moderation_retry", "error"].includes(record.status)
    || !(record.next_attempt_at === null || Date.parse(record.next_attempt_at) <= now)) return null;

  const lockTime = new Date(Math.max(now, Date.parse(version) + 1)).toISOString();
  const exhausted = attempt >= MAX_ATTEMPTS;
  const expectedStatus = exhausted ? "moderation_error" : "moderating";
  const expectedAttempt = exhausted ? attempt : attempt + 1;
  let query = admin.from("image_moderation_records").update({
    status: expectedStatus,
    attempt_count: expectedAttempt,
    locked_at: exhausted ? null : lockTime,
    next_attempt_at: null,
    updated_at: lockTime,
    ...(exhausted ? {
      last_error_code: "automatic_attempts_exhausted",
      last_error_message: "Automatic review attempts are exhausted. Human review is required.",
      error_code: "automatic_attempts_exhausted",
    } : {}),
  }).eq("id", record.id).eq("updated_at", version).eq("status", record.status)
    .eq("decision", "review").is("review_decision", null).eq("attempt_count", attempt);
  query = record.locked_at === null ? query.is("locked_at", null) : query.eq("locked_at", record.locked_at);
  query = record.next_attempt_at === null ? query.is("next_attempt_at", null) : query.eq("next_attempt_at", record.next_attempt_at);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (data) {
    galleryReviewVersion(data.updated_at);
    if (data.id !== record.id || data.user_id !== record.user_id || data.decision !== "review"
      || data.status !== expectedStatus || data.attempt_count !== expectedAttempt
      || data.temporary_storage_path !== record.temporary_storage_path || data.upload_context !== record.upload_context
      || data.avatar_expected_path !== record.avatar_expected_path
      || data.avatar_expected_updated_at !== record.avatar_expected_updated_at
      || data.review_decision !== null
      || (exhausted ? data.locked_at !== null : Date.parse(data.locked_at) !== Date.parse(lockTime))
      || data.next_attempt_at !== null) {
      throw new Error("Image moderation claim could not be confirmed.");
    }
  }
  return data;
}
