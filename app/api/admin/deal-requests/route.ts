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
      .from("venue_club_deal_requests")
      .select("id,venue_id,request_type,offer_title,request_notes,status,created_at,venues(name,city,state)", { count: "exact" })
      .in("status", ["pending", "under_review"])
      .order("created_at", { ascending: true })
      .order("id")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || typeof count !== "number") throw new Error("Request totals could not be confirmed.");
    return NextResponse.json({ ok: true, requests: data, total: count, hasMore: (page + 1) * PAGE_SIZE < count, session }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return apiError(error, "Unable to load club deal requests.");
  }
}
