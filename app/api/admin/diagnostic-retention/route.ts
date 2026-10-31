import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function owner(request: Request) {
  const { client, user, session } = await createRequestSupabaseContext(request);
  const role = await requireAdmin(client, user.id, "compliance");
  if (role !== "owner") throw new PublicApiError("FORBIDDEN", "Only owners can manage diagnostic cleanup.", 403);
  return { user, session };
}
export async function GET(request: Request) {
  try {
    const { session } = await owner(request);
    const db = createAdminSupabaseClient();
    const [preview, runs] = await Promise.all([
      db.rpc("preview_diagnostic_retention"),
      db.from("diagnostic_retention_runs").select("*").order("started_at", { ascending: false }).limit(24),
    ]);
    if (preview.error) throw preview.error;
    if (runs.error) throw runs.error;
    return NextResponse.json({ ok: true, preview: preview.data, runs: runs.data, session: session || null }, { headers });
  } catch (error) { return apiError(error, "Unable to load diagnostic cleanup."); }
}
export async function POST(request: Request) {
  try {
    const { user, session } = await owner(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid cleanup operation.", tooLargeMessage: "Cleanup operation is too large." });
    if (!["enabled", "protect", "review_hold"].includes(String(body.action))) {
      throw new PublicApiError("INVALID_REQUEST", "Choose a diagnostic cleanup operation.", 400);
    }
    // Actor always comes from the validated session. This endpoint cannot execute deletion.
    const { data, error } = await createAdminSupabaseClient().rpc("manage_diagnostic_retention", {
      p_actor: user.id, p_action: body.action,
      p_values: { enabled: body.enabled, holdId: body.holdId, revision: body.revision,
        source: body.source, recordKey: body.recordKey, note: body.note },
    });
    if (error?.code === "P0001") throw new PublicApiError("CONFLICT", error.message, 409);
    if (error) throw error;
    return NextResponse.json({ ok: true, preview: data, session: session || null }, { headers });
  } catch (error) { return apiError(error, "Unable to save diagnostic cleanup settings."); }
}
