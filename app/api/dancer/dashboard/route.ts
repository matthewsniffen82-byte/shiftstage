import { NextResponse } from "next/server";
import { getDancerDashboardAnalytics } from "@/src/lib/dancr/dancer";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const dancerId = url.searchParams.get("dancerId");

    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Missing dancerId." }, { status: 400 });
    }

    const analytics = await getDancerDashboardAnalytics(createAdminSupabaseClient(), dancerId);
    return NextResponse.json({ ok: true, analytics });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load dancer analytics." },
      { status: 500 },
    );
  }
}
