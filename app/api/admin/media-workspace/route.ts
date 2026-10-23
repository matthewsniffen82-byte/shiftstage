import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { claimAdminMedia, getAdminMediaWorkspace, ADMIN_UUID } from "@/src/lib/dancr/admin-media-workspace";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "reviewer");
    const db = createAdminSupabaseClient() as any;
    const params = new URL(request.url).searchParams;
    if (params.get("historyId") && ADMIN_UUID.test(params.get("historyId")!)) {
      const { data, error } = await db.from("admin_media_review_events").select("*,actor:app_users(display_name,email)")
        .eq("item_id", params.get("historyId")).eq("kind", params.get("kind")).order("created_at");
      if (error) throw error;
      return NextResponse.json({ ok: true, events: data, session });
    }
    return NextResponse.json({ ok: true, ...await getAdminMediaWorkspace(db, params), session });
  } catch (error) { return apiError(error, "Unable to load media reviews."); }
}
export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "reviewer");
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid review claim.", tooLargeMessage: "Review claim is too large." });
    const claim = await claimAdminMedia(createAdminSupabaseClient(), user.id, String(body.kind), String(body.id), body.version, body.release === true);
    return NextResponse.json({ ok: true, claim, session });
  } catch (error) { return apiError(error, "Unable to claim this upload."); }
}
