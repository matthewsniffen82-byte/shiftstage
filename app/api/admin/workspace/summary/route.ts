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
    const db = createAdminSupabaseClient();
    const stalled = new Date(Date.now() - 30 * 60000).toISOString();
    const timings: Record<string, number> = {};
    async function count<T>(stage: string, query: PromiseLike<T>): Promise<T> {
      const startedAt = Date.now();
      try { return await query; } finally { timings[stage] = Date.now() - startedAt; }
    }
    const batchCount = (hours: number) => db.rpc("get_media_batches_page", {
      p_actor: user.id, p_role: "admin", p_venue: null, p_dancer: null, p_page: 0, p_hours: hours, p_counts_only: true,
    });
    const results = await Promise.all([
      count("ready_batches", batchCount(0)),
      count("overdue_batches", batchCount(24)),
      count("staff_media", db.rpc("get_admin_media_dancers", { p_actor: user.id, p_stage: "staff", p_kind: "all",
        p_venue_id: null, p_search: "", p_hours: 24, p_offset: 0, p_counts_only: true })),
      count("stalled", db.from("admin_media_workspace").select("id", { count: "exact", head: true }).eq("stage", "processing").lt("updated_at", stalled)),
      count("setups", db.from("venues").select("id", { count: "exact", head: true }).is("admin_deleted_at", null).neq("page_review_status", "published")),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const [readyBatches, overdueBatches, standalone, processing, setup] = results;
    const ready = readyBatches.data.count + standalone.data.counts.staff;
    const overdue = overdueBatches.data.count + standalone.data.total;
    if (Object.values(timings).some(ms => ms >= 1000)) console.info(JSON.stringify({ event: "admin.summary_timing", timings }));
    const timingHeader = Object.entries(timings).map(([stage, ms]) => `${stage};dur=${ms}`).join(", ");
    return NextResponse.json({ ok: true, session, ready, overdue, stalled: processing.count, setups: setup.count, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", "Server-Timing": timingHeader } });
  } catch (error) { return apiError(error, "Unable to refresh urgent work."); }
}
