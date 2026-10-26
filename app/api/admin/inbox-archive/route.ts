import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { INBOX_KINDS, parseInboxArchiveAction, type InboxKind } from "@/src/lib/dancr/admin-inbox-archive";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const role = await requireAdmin(client, user.id, "support");
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") || 0), kind = params.get("kind");
    if (!Number.isSafeInteger(page) || page < 0 || page > 10_000 || (kind && !INBOX_KINDS.includes(kind as InboxKind))) throw new PublicApiError("INVALID_REQUEST", "Choose a valid archive page.", 400);
    if (role !== "owner" && kind && kind !== "support") throw new PublicApiError("FORBIDDEN", "Your staff role does not allow this action.", 403);
    let query = (createAdminSupabaseClient() as any).from("admin_inbox_archive").select("kind,id,archived_at,summary", { count: "exact" });
    if (role !== "owner" || kind) query = query.eq("kind", role === "owner" ? kind : "support");
    const { data, count, error } = await query.order("archived_at", { ascending: false }).order("kind").order("id").range(page * 20, page * 20 + 19);
    if (error) throw error;
    if (!Array.isArray(data) || typeof count !== "number") throw new Error("Archive could not be confirmed.");
    return NextResponse.json({ ok: true, items: data, total: count, hasMore: (page + 1) * 20 < count, session }, { headers });
  } catch (error) { return apiError(error, "Unable to load archived items."); }
}

export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "support");
    const body = await readBoundedJsonObject(request, { maxBytes: 32_768, invalidMessage: "Invalid archive request.", tooLargeMessage: "Choose fewer items." });
    const { action, items } = parseInboxArchiveAction(body);
    if (items.some(item => item.kind !== "support")) await requireAdmin(client, user.id);
    const { data, error } = await (createAdminSupabaseClient() as any).rpc("set_admin_inbox_archive", { p_admin_id: user.id, p_action: action, p_items: items });
    if (error) {
      if (error.code === "40001") throw new PublicApiError("CONFLICT", "An item changed. Refresh the inbox and try again.", 409);
      if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "Your staff role does not allow this action.", 403);
      if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "An item no longer exists. Refresh the inbox.", 404);
      if (["22023", "22P02", "22007", "22008"].includes(error.code)) throw new PublicApiError("INVALID_REQUEST", "Invalid archive selection. Refresh and try again.", 400);
      throw error;
    }
    if (!data || typeof data.changed !== "number") throw new Error("Archive change could not be confirmed.");
    return NextResponse.json({ ok: true, changed: data.changed, session }, { headers });
  } catch (error) { return apiError(error, "Unable to update the archive."); }
}
