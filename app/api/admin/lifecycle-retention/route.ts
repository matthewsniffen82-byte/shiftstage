import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "owner");
    const db = createAdminSupabaseClient();
    const [preview, runs] = await Promise.all([
      db.rpc("preview_lifecycle_retention"),
      db.from("lifecycle_retention_runs").select("id,source,started_at,status,removed,reason,error_code,retry_after").order("started_at", { ascending: false }).limit(100),
    ]);
    if (preview.error) throw preview.error;
    if (runs.error) throw runs.error;
    return NextResponse.json({ ok: true, preview: preview.data, runs: runs.data, session }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load retention operations."); }
}
