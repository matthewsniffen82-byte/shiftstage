import { after, NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  hideOwnMyDancrTvVideo,
  retryMyDancrTvAutomatedModeration,
  submitMyDancrTvUpload,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
    const { user } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_TV_ACTION_BODY_BYTES,
      invalidMessage: "Invalid video action request.",
      tooLargeMessage: "Video action request is too large.",
    });
    if (body?.action !== "submit") {
      return NextResponse.json({ ok: false, error: "Invalid video action." }, { status: 400 });
    }
    const video = await submitMyDancrTvUpload(
      createAdminSupabaseClient(),
      user.id,
      id,
      { deferModeration: true },
    );
    if (!("submissionAlreadyAccepted" in video) || video.submissionAlreadyAccepted !== true) {
      after(async () => {
        try {
          await retryMyDancrTvAutomatedModeration(createAdminSupabaseClient(), video.id);
        } catch (error) {
          console.error(JSON.stringify({
            event: "mydancr_tv.background_moderation_failed",
            videoId: video.id,
            message: error instanceof Error ? error.message.slice(0, 500) : "Unknown moderation failure",
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
    return apiError(error, "Unable to submit your MyDancr TV video.", 400);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV video." }, { status: 400 });
    }
    const { user } = await createRequestSupabaseContext(request);
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
    return "Your video uploaded successfully and is queued for automatic safety review.";
  }
  if (video?.status === "approved") {
    return "Your video passed safety review and will appear whenever your dancer profile is live.";
  }
  if (video?.status === "rejected") {
    return "Your video did not pass MyDancr TV safety review. Review the status below before uploading another video.";
  }
  return "Your video was checked automatically and sent to an administrator for human review.";
}
