import { NextResponse } from "next/server";
import { resolveApiError } from "@/src/lib/api-error-policy";
import { internalMainPhotos } from "@/src/lib/dancr/internal-main-photo";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });

function failure(error: unknown) {
  const resolved = resolveApiError(error, "Unable to load your main photo.");
  return json(resolved.body, resolved.status);
}

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const admin = createAdminSupabaseClient();
    const { data: profile, error } = await admin.from("dancer_profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const photo = profile ? (await internalMainPhotos(admin, [profile.id])).get(profile.id) : null;
    return json({ ok: true, photoId: null, displayedPhotoId: photo?.id || null, session });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const { session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    // Older open dashboards must not silently save a choice that no longer applies.
    return json({ ok: false, error: "Your main photo is now used on the club roster. Refresh your dashboard and use Main photo to change it.", session }, 410);
  } catch (error) { return failure(error); }
}
