import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import {
  autoApprovePendingMyDancrTvDemoVideo,
  retryMyDancrTvAutomatedModeration,
} from "@/src/lib/dancr/tv";
import { isVideoDemoAutoApproveMode } from "@/src/lib/dancr/video-moderation-mode";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOBS_PER_RUN = 2;
const STALE_AFTER_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminSupabaseClient();
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const demoAutoApprove = isVideoDemoAutoApproveMode();

  try {
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
          message: error instanceof Error ? error.message.slice(0, 500) : "Unknown retry failure",
        }));
        results.push({ videoId: video.id, ok: false });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(JSON.stringify({
      event: demoAutoApprove
        ? "mydancr_tv.demo_auto_approval_cron_failed"
        : "mydancr_tv.ai_moderation_cron_failed",
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown worker failure",
    }));
    return NextResponse.json(
      { ok: false, error: "Video moderation recovery worker failed." },
      { status: 500 },
    );
  }
}
