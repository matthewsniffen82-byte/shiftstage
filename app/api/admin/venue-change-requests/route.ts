import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const page = Number(new URL(request.url).searchParams.get("page") || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
      throw new PublicApiError("INVALID_REQUEST", "Choose a valid request page.", 400);
    }
    const { data, count, error } = await (createAdminSupabaseClient() as any)
      .from("venues")
      .select("id,name,city,state,page_review_status,page_review_notes,page_reviewed_at,updated_at", { count: "exact" })
      .is("admin_archived_at", null)
      .eq("page_review_status", "changes_requested")
      .order("page_reviewed_at", { ascending: true, nullsFirst: false })
      .order("id")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || typeof count !== "number") throw new Error("Request totals could not be confirmed.");
    return NextResponse.json({ ok: true, requests: data, total: count, hasMore: (page + 1) * PAGE_SIZE < count, session }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return apiError(error, "Unable to load club page change requests.");
  }
}
