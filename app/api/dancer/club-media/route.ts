import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowProfileSetup: true });
    const { data, error } = await createAdminSupabaseClient().rpc("dancer_club_media_statuses", { p_user_id: user.id });
    if (error) throw error;
    return NextResponse.json({ ok: true, statuses: data, session }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load your club media approvals."); }
}
