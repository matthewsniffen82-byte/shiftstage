import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const db = createAdminSupabaseClient() as any;
    const day = new Date(Date.now() - 86400000).toISOString(), stalled = new Date(Date.now() - 30 * 60000).toISOString();
    const results = await Promise.all([
      db.from("admin_media_workspace").select("id", { count: "exact", head: true }).eq("stage", "staff"),
      db.from("admin_media_workspace").select("id", { count: "exact", head: true }).in("stage", ["staff", "club"]).lt("created_at", day),
      db.from("admin_media_workspace").select("id", { count: "exact", head: true }).eq("stage", "processing").lt("updated_at", stalled),
      db.from("venues").select("id", { count: "exact", head: true }).neq("page_review_status", "published"),
    ]);
    for (const result of results) if (result.error) throw result.error;
    return NextResponse.json({ ok: true, session, ready: results[0].count, overdue: results[1].count, stalled: results[2].count, setups: results[3].count, checkedAt: new Date().toISOString() });
  } catch (error) { return apiError(error, "Unable to refresh urgent work."); }
}
