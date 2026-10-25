import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("venue") || "";
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(key)) return NextResponse.json({ ok: false }, { status: 400, headers });
  try {
    const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) ? "id" : "slug";
    const { data, error } = await createAdminSupabaseClient().from("venues")
      .select("id,name,city").eq(column, key).eq("is_active", true).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, venue: data }, { headers });
  } catch (error) { return apiError(error, "Unable to load this club."); }
}
