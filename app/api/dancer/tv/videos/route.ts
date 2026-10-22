import { after, NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createMyDancrTvUpload,
  getDancerMyDancrTvWorkspace,
  retryMyDancrTvAutomatedModeration,
} from "@/src/lib/dancr/tv";
import {
  DancerMediaRateLimitError,
  enforceDancerMediaRequestRateLimit,
} from "@/src/lib/dancr/media-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { canRecoverVideoProcessing } from "@/src/lib/dancr/video-processing-state";
import { runWithServerJob, VIDEO_PROCESSING_JOB_TIMEOUT_MS, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS } from "@/src/lib/server-job";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_TV_UPLOAD_METADATA_BYTES = 4_096;

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const workspace = await getDancerMyDancrTvWorkspace(createAdminSupabaseClient(), user.id);
    // Only this authenticated dancer's saved jobs. Atomic worker claims prevent
    // duplicate processing when another tab or the cron picks up the same job.
    const recoverable = workspace.videos.filter(video => canRecoverVideoProcessing(video))
      .sort((a, b) => String(a.moderationStartedAt || "").localeCompare(String(b.moderationStartedAt || "")))
      .slice(0, 2);
    if (recoverable.length) after(async () => {
      const remainingMs = Math.floor(VIDEO_PROCESSING_ROUTE_TIMEOUT_MS - (performance.now() - startedAt));
      if (remainingMs < VIDEO_PROCESSING_JOB_TIMEOUT_MS) return;
      await Promise.allSettled(recoverable.map(async video => {
        try {
          await runWithServerJob(() => retryMyDancrTvAutomatedModeration(createAdminSupabaseClient(), video.id), remainingMs);
        } catch (error) {
          console.error(JSON.stringify({ event: "mydancr_tv.owner_recovery_failed", videoId: video.id, ...safeErrorMetadata(error) }));
        }
      }));
    });
    return NextResponse.json({ ok: true, ...workspace }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load your MyDancr TV videos.");
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    await enforceDancerMediaRequestRateLimit(admin, {
      media: "video",
      request,
      userId: user.id,
    });
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_TV_UPLOAD_METADATA_BYTES,
      invalidMessage: "Invalid MyDancr TV upload request.",
      tooLargeMessage: "MyDancr TV upload request is too large.",
    });
    const upload = await createMyDancrTvUpload(admin, user.id, {
      mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
      fileSize: Number(body?.fileSize),
      durationSeconds: Number(body?.durationSeconds),
      width: Number(body?.width),
      height: Number(body?.height),
      consentConfirmed: body?.consentConfirmed === true,
      rightsConfirmed: body?.rightsConfirmed === true,
      edit: body.edit,
      uploadId: typeof body?.uploadId === "string" ? body.uploadId : "",
    });
    return NextResponse.json({ ok: true, upload }, { status: 201 });
  } catch (error) {
    if (error instanceof DancerMediaRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many video uploads. Wait before uploading again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to prepare your MyDancr TV upload.", 400);
  }
}
