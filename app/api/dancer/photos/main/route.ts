import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { finalizePendingDancerNfcEnrollment } from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { dancerMediaEditor, editClubMedia } from "@/src/lib/dancr/dancer-media-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Choose an approved photo.", tooLargeMessage: "Invalid photo selection." });
    if (typeof body.photoId !== "string" || !uuid.test(body.photoId)
      || (body.mainPhotoId !== null && (typeof body.mainPhotoId !== "string" || !uuid.test(body.mainPhotoId)))) {
      return NextResponse.json({ ok: false, error: "Choose an approved photo." }, { status: 400 });
    }
    const admin = createAdminSupabaseClient();
    const editor = await dancerMediaEditor(admin, user.id, request);
    if (editor.venueId) {
      await editClubMedia(admin, user.id, editor, "photo", body.photoId, "main");
      return NextResponse.json({ ok: true, photoId: body.photoId, clubOnly: true, session }, { headers: { "cache-control": "private, no-store" } });
    }
    const { data, error } = await admin.rpc("choose_approved_dancer_main_photo", {
      p_user: user.id, p_photo: body.photoId, p_expected_main: body.mainPhotoId,
    });
    if (error) return NextResponse.json({ ok: false, error: error.code === "40001"
      ? "Your main photo changed or is awaiting review. Refresh before choosing another."
      : "Choose one of your approved photos." }, { status: error.code === "40001" ? 409 : 403 });
    // Reuse the existing eligibility/expiry checks; choosing a photo never
    // fabricates a club tap or bypasses age, agreement, or club approval.
    try { await finalizePendingDancerNfcEnrollment(admin, { dancerUserId: user.id, request }); }
    catch (error) { console.warn("MAIN_PHOTO_CHECK_IN_DEFERRED", safeErrorMetadata(error)); }
    return NextResponse.json({ ok: true, photoId: data, session }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to choose your main photo."); }
}
