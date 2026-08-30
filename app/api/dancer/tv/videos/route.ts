import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createMyDancrTvUpload,
  getDancerMyDancrTvWorkspace,
} from "@/src/lib/dancr/tv";
import {
  DancerMediaRateLimitError,
  enforceDancerMediaRequestRateLimit,
} from "@/src/lib/dancr/media-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_TV_UPLOAD_METADATA_BYTES = 4_096;

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const workspace = await getDancerMyDancrTvWorkspace(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, ...workspace });
  } catch (error) {
    return apiError(error, "Unable to load your MyDancr TV videos.");
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
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
