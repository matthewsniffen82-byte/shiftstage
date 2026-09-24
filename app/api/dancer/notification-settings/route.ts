import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { dancerNotificationMetadataPatch, dancerNotificationSettings } from "@/src/lib/dancr/dancer-notification-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    return NextResponse.json({ ok: true, userId: user.id, settings: dancerNotificationSettings(user.user_metadata), session }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error, "Unable to load notification settings.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const body = await readBoundedJsonObject(request, { maxBytes: 2_048, invalidMessage: "Invalid notification settings.", tooLargeMessage: "Notification settings are too large." });
    let metadata: Record<string, boolean>;
    try { metadata = dancerNotificationMetadataPatch(body.settings); }
    catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
    const { data, error } = await createAdminSupabaseClient().auth.admin.updateUserById(user.id, { user_metadata: metadata });
    if (error || !data.user) throw error || new Error("Notification settings were not saved.");
    return NextResponse.json({ ok: true, userId: user.id, settings: dancerNotificationSettings(data.user.user_metadata), session }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error, "Unable to save notification settings.");
  }
}
