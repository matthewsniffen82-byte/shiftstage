import { after, NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  hideOwnMyDancrTvVideo,
  queueOwnMyDancrTvReviewRetry,
  submitMyDancrTvUpload,
} from "@/src/lib/dancr/tv";
import {
  DancerMediaRateLimitError,
  enforceDancerMediaRequestRateLimit,
} from "@/src/lib/dancr/media-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { dispatchVideoModeration } from "@/src/lib/dancr/video-worker-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_TV_ACTION_BODY_BYTES = 2_048;

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV video." }, { status: 400 });
    }
    const { user } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_TV_ACTION_BODY_BYTES,
      invalidMessage: "Invalid video action request.",
      tooLargeMessage: "Video action request is too large.",
    });
    if (body?.action !== "submit" && body?.action !== "retry" && body?.action !== "dismiss-rejected") {
      return NextResponse.json({ ok: false, error: "Invalid video action." }, { status: 400 });
    }
    if (body.action === "dismiss-rejected") {
      const video = await hideOwnMyDancrTvVideo(admin, user.id, id, true);
      return NextResponse.json({ ok: true, dismissedId: video.id }, { headers: { "Cache-Control": "no-store" } });
    }
    await enforceDancerMediaRequestRateLimit(admin, { media: "video", request, userId: user.id });
    const video = body.action === "retry" ? await queueOwnMyDancrTvReviewRetry(admin, user.id, id) : await submitMyDancrTvUpload(
      admin,
      user.id,
      id,
      { deferModeration: true },
    );
    if (!("submissionAlreadyAccepted" in video) || video.submissionAlreadyAccepted !== true) {
      after(async () => {
        try {
          await dispatchVideoModeration(video.id);
        } catch (error) {
          console.error(JSON.stringify({
            event: "mydancr_tv.background_moderation_failed",
            videoId: video.id,
            ...safeErrorMetadata(error),
          }));
        }
      });
    }
    return NextResponse.json({
      ok: true,
      video,
      message: moderationMessage(video),
    });
  } catch (error) {
    if (error instanceof DancerMediaRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many video uploads. Wait before uploading again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to submit your MyDancr TV video.", 400);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV video." }, { status: 400 });
    }
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const video = await hideOwnMyDancrTvVideo(createAdminSupabaseClient(), user.id, id);
    return NextResponse.json({ ok: true, video, message: "Video removed from MyDancr TV." });
  } catch (error) {
    return apiError(error, "Unable to remove your MyDancr TV video.", 400);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function moderationMessage(video: any) {
  if (video?.status === "moderating") {
    return "Video uploaded. Preparing it for club review, then MyDancr final approval.";
  }
  if (video?.status === "approved") {
    return "Your video was approved by your club and will appear whenever your dancer profile is live.";
  }
  if (video?.status === "rejected") {
    return "Your video did not pass MyDancr TV safety review. Review the status below before uploading another video.";
  }
  return "Your video was checked automatically and saved for your club to review.";
}
