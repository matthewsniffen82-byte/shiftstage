import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import {
  autoApprovePendingMyDancrTvDemoVideo,
  retryMyDancrTvAutomatedModeration,
} from "@/src/lib/dancr/tv";
import { isVideoDemoAutoApproveMode } from "@/src/lib/dancr/video-moderation-mode";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { VIDEO_PROCESSING_JOB_TIMEOUT_MS, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS, MODERATION_WORKER_STALE_MS, runWithServerJob, serverJobRemainingMs } from "@/src/lib/server-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_JOBS_PER_RUN = 2;
const STALE_AFTER_MS = MODERATION_WORKER_STALE_MS;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminSupabaseClient();
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const demoAutoApprove = isVideoDemoAutoApproveMode();

  try {
    return await runWithServerJob(async () => {
    let query = admin
      .from("mydancr_tv_videos")
      .select("id, status")
      .lt("moderation_attempt_count", 3)
      .limit(MAX_JOBS_PER_RUN);
    query = demoAutoApprove
      ? query
          .in("status", ["submitted", "moderating"])
          .order("submitted_at", { ascending: true, nullsFirst: false })
      : query
          .eq("status", "moderating")
          .lt("moderation_started_at", staleBefore)
          .order("moderation_started_at", { ascending: true });
    const { data: videos, error } = await query;
    if (error) throw error;

    const results = [];
    for (const video of videos || []) {
      if (serverJobRemainingMs() < VIDEO_PROCESSING_JOB_TIMEOUT_MS) break;
      try {
        const result = demoAutoApprove && video.status === "submitted"
          ? await autoApprovePendingMyDancrTvDemoVideo(admin, video.id)
          : await retryMyDancrTvAutomatedModeration(admin, video.id);
        results.push({
          videoId: video.id,
          ok: Boolean(result),
          status: result?.status || "not_claimed",
          decision: result?.moderation_decision || null,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: demoAutoApprove
            ? "mydancr_tv.demo_auto_approval_retry_failed"
            : "mydancr_tv.ai_moderation_retry_failed",
          videoId: video.id,
          ...safeErrorMetadata(error),
        }));
        results.push({ videoId: video.id, ok: false });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
    }, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS);
  } catch (error) {
    console.error(JSON.stringify({
      event: demoAutoApprove
        ? "mydancr_tv.demo_auto_approval_cron_failed"
        : "mydancr_tv.ai_moderation_cron_failed",
      ...safeErrorMetadata(error),
    }));
    return NextResponse.json(
      { ok: false, error: "Video moderation recovery worker failed." },
      { status: 500 },
    );
  }
}
