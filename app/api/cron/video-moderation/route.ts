import { NextResponse } from "next/server";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import {
  retryMyDancrTvAutomatedModeration,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { VIDEO_PROCESSING_JOB_TIMEOUT_MS, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS, MODERATION_WORKER_STALE_MS, runWithServerJob, serverJobRemainingMs } from "@/src/lib/server-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_JOBS_PER_RUN = 2;
const STALE_AFTER_MS = MODERATION_WORKER_STALE_MS;

/** Uploads dispatch here after saving a durable job; claims make delivery idempotent. */
export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 256,
      invalidMessage: "Invalid video job.", tooLargeMessage: "Invalid video job." });
    if (typeof body.videoId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.videoId)) {
      return NextResponse.json({ ok: false, error: "Invalid video job." }, { status: 400 });
    }
    const result = await runWithServerJob(
      () => retryMyDancrTvAutomatedModeration(createAdminSupabaseClient(), body.videoId as string),
      VIDEO_PROCESSING_ROUTE_TIMEOUT_MS,
    );
    return NextResponse.json({ ok: true, status: result?.status || "not_claimed" });
  } catch (error) {
    console.error(JSON.stringify({ event: "mydancr_tv.worker_failed", ...safeErrorMetadata(error) }));
    return NextResponse.json({ ok: false, error: "Video worker failed; saved jobs remain recoverable." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminSupabaseClient();
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  try {
    return await runWithServerJob(async () => {
    let query = admin
      .from("mydancr_tv_videos")
      .select("id, status, moderation_attempt_count", { count: "exact" })
      .limit(MAX_JOBS_PER_RUN);
    query = query.eq("status", "moderating")
      .lt("moderation_started_at", staleBefore)
      .order("moderation_started_at", { ascending: true });
    const { data: videos, count: eligibleAtStart, error } = await query;
    if (error) throw error;

    const results = [];
    for (const video of videos || []) {
      const requiredMs = video.status === "moderating" && video.moderation_attempt_count >= 3
        ? 15_000 : VIDEO_PROCESSING_JOB_TIMEOUT_MS;
      if (serverJobRemainingMs() < requiredMs) break;
      try {
        const result = await retryMyDancrTvAutomatedModeration(admin, video.id);
        results.push({
          videoId: video.id,
          ok: Boolean(result),
          status: result?.status || "not_claimed",
          decision: result?.moderation_decision || null,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: "mydancr_tv.ai_moderation_retry_failed",
          videoId: video.id,
          ...safeErrorMetadata(error),
        }));
        results.push({ videoId: video.id, ok: false });
      }
    }

    const failed = results.filter(result => !result.ok && result.status !== "not_claimed").length;
    console.info(JSON.stringify({ event: "mydancr_tv.recovery_completed", eligibleAtStart, processed: results.length, failed }));
    return NextResponse.json({ ok: failed === 0, eligibleAtStart, processed: results.length, failed, results }, { status: failed ? 500 : 200 });
    }, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS);
  } catch (error) {
    console.error(JSON.stringify({
      event: "mydancr_tv.ai_moderation_cron_failed",
      ...safeErrorMetadata(error),
    }));
    return NextResponse.json(
      { ok: false, error: "Video moderation recovery worker failed." },
      { status: 500 },
    );
  }
}
