import { NextResponse } from "next/server";
import { retryMyDancrTvAutomatedModeration } from "@/src/lib/dancr/tv";
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

  try {
    const { data: videos, error } = await admin
      .from("mydancr_tv_videos")
      .select("id")
      .eq("status", "moderating")
      .lt("moderation_started_at", staleBefore)
      .lt("moderation_attempt_count", 3)
      .order("moderation_started_at", { ascending: true })
      .limit(MAX_JOBS_PER_RUN);
    if (error) throw error;

    const results = [];
    for (const video of videos || []) {
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
          message: error instanceof Error ? error.message.slice(0, 500) : "Unknown retry failure",
        }));
        results.push({ videoId: video.id, ok: false });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error(JSON.stringify({
      event: "mydancr_tv.ai_moderation_cron_failed",
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown worker failure",
    }));
    return NextResponse.json(
      { ok: false, error: "Video moderation recovery worker failed." },
      { status: 500 },
    );
  }
}

function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
