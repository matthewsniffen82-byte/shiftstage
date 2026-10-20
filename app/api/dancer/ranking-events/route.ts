import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await createRequestSupabaseContext(request, { role: "dancer" });
    // Keep older clients compatible without exposing private ranking milestones.
    return NextResponse.json({ ok: true, events: [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load activity.");
  }
}
