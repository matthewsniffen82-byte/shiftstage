import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminMyDancrTvVideos,
  reviewMyDancrTvVideo,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const status = new URL(request.url).searchParams.get("status") || "submitted";
    const videos = await getAdminMyDancrTvVideos(createAdminSupabaseClient(), status);
    return NextResponse.json({ ok: true, videos, count: videos.length });
  } catch (error) {
    return apiError(error, "Unable to load MyDancr TV moderation.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json();
    const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
    const decision = body?.decision === "approved" || body?.decision === "rejected"
      ? body.decision
      : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
    if (!UUID_PATTERN.test(videoId) || !decision) {
      return NextResponse.json({ ok: false, error: "Choose a video and decision." }, { status: 400 });
    }
    const video = await reviewMyDancrTvVideo(
      createAdminSupabaseClient(),
      user.id,
      videoId,
      decision,
      notes,
    );
    return NextResponse.json({
      ok: true,
      video,
      message: decision === "approved"
        ? "Video approved and published on MyDancr TV."
        : "Video rejected and the dancer was notified.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (VIDEO_REVIEW_CLIENT_ERRORS.has(message)) {
      return apiError(error, "Unable to review MyDancr TV video.", 400);
    }
    console.error(JSON.stringify({
      event: "mydancr_tv.admin_review_failed",
      message: message.slice(0, 500) || "Unknown video review failure",
    }));
    return NextResponse.json(
      {
        ok: false,
        error: "Video processing is temporarily unavailable. The video was not changed. Try again shortly.",
      },
      { status: 503 },
    );
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VIDEO_REVIEW_CLIENT_ERRORS = new Set([
  "Sign in required.",
  "Admin access required.",
  "Video not found.",
  "This video is no longer waiting for review.",
  "The dancer profile is not eligible for media onboarding.",
  "Only videos that are 30 seconds or shorter can be approved.",
  "Add a clear rejection reason for the dancer.",
]);
