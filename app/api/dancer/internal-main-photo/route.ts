import { NextResponse } from "next/server";
import { PublicApiError, resolveApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { internalMainPhotos } from "@/src/lib/dancr/internal-main-photo";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const publicError = code === "42501"
    ? new PublicApiError("FORBIDDEN", "Your dancer account cannot change this photo.", 403)
    : code === "P0002"
      ? new PublicApiError("NOT_FOUND", "Choose an approved photo from your own gallery.", 404)
      : error;
  const resolved = resolveApiError(publicError, "Unable to save your Internal main photo.");
  return json(resolved.body, resolved.status);
}

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    const { data: profile, error } = await admin.from("dancer_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const photo = profile ? (await internalMainPhotos(admin, [profile.id])).get(profile.id) : null;
    return json({ ok: true, photoId: photo?.explicitlySelected ? photo.id : null, displayedPhotoId: photo?.id || null, session });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Choose a main photo.", tooLargeMessage: "Photo choice is too large." });
    if (typeof body.photoId !== "string" || !uuid.test(body.photoId)) {
      throw new PublicApiError("INVALID_REQUEST", "Choose a valid photo.", 400);
    }
    const { data, error } = await createAdminSupabaseClient().rpc("set_dancer_internal_main_photo", {
      p_actor_user_id: user.id, p_photo_id: body.photoId,
    });
    if (error) throw error;
    if (data !== body.photoId) throw new PublicApiError("UNAVAILABLE", "Unable to confirm your main photo. Refresh and try again.", 503);
    return json({ ok: true, photoId: data, displayedPhotoId: data, session });
  } catch (error) { return failure(error); }
}
