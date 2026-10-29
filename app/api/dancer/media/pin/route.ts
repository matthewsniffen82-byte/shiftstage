import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { pinOwnDancerMedia } from "@/src/lib/dancr/media-pins";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { dancerMediaEditor, editClubMedia } from "@/src/lib/dancr/dancer-media-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const body = await readBoundedJsonObject(request, {
      maxBytes: 2048,
      invalidMessage: "Invalid media pin request.",
      tooLargeMessage: "Media pin request is too large.",
    });
    if ((body.mediaType !== "photo" && body.mediaType !== "video")
      || typeof body.mediaId !== "string" || !UUID_PATTERN.test(body.mediaId)
      || typeof body.pinned !== "boolean") {
      return NextResponse.json({ ok: false, error: "Invalid media pin request." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient(), editor = await dancerMediaEditor(admin, user.id, request);
    const media = editor.venueId ? await editClubMedia(admin, user.id, editor, body.mediaType, body.mediaId, "pin", body.pinned) : await pinOwnDancerMedia(admin, user.id, {
      mediaType: body.mediaType, mediaId: body.mediaId, pinned: body.pinned,
    });
    return NextResponse.json({ ok: true, media, session });
  } catch (error) {
    return apiError(error, "Unable to save the pin. Try again.", 400);
  }
}
