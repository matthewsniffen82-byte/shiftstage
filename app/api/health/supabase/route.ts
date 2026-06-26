import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "../../../../src/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.from("venues").select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json({ ok: false, service: "supabase", error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, service: "supabase" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "supabase",
        error: error instanceof Error ? error.message : "Unknown health check error.",
      },
      { status: 500 },
    );
  }
}
