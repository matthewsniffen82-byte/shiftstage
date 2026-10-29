import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { reservePhotoUpload } from "@/src/lib/dancr/photo-upload-reservation";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { dancerMediaEditor, assertEditorMedia } from "@/src/lib/dancr/dancer-media-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "dancer_photo_transfer", request, subject: user.id, windowSeconds: 3600, ipLimit: 80, subjectLimit: 24 });
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid photo upload.", tooLargeMessage: "Invalid photo upload." });
    const editor = await dancerMediaEditor(admin, user.id, request);
    if (editor.venueId && typeof body.replacementPhotoId === "string" && body.replacementPhotoId) await assertEditorMedia(admin, user.id, editor, "photo", body.replacementPhotoId);
    const upload = await reservePhotoUpload(admin, user.id, { ...body, editorVenueId: editor.venueId });
    return NextResponse.json({ ok: true, upload }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Too many photo uploads. Please wait before trying again." }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to prepare the photo upload.");
  }
}
