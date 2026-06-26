import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const socialPlatforms = new Set(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const client = createAdminSupabaseClient();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

    if (body.type === "profile_view") {
      if (!body.dancerId) return missing("dancerId");
      const { error } = await client.from("profile_views").insert({
        dancer_id: body.dancerId,
        viewer_id: body.viewerId || null,
        source: body.source || "web",
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (body.type === "schedule_view") {
      if (!body.dancerId) return missing("dancerId");
      const { error } = await client.from("schedule_views").insert({
        dancer_id: body.dancerId,
        shift_id: body.shiftId || null,
        viewer_id: body.viewerId || null,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (body.type === "direction_request") {
      if (!body.venueId) return missing("venueId");
      const { error } = await client.from("direction_requests").insert({
        dancer_id: body.dancerId || null,
        venue_id: body.venueId,
        requester_id: body.viewerId || null,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (body.type === "social_click") {
      if (!body.dancerId) return missing("dancerId");
      if (!socialPlatforms.has(body.platform)) return missing("valid platform");
      const { error } = await client.from("social_clicks").insert({
        dancer_id: body.dancerId,
        platform: body.platform,
        clicker_id: body.viewerId || null,
        session_id: sessionId,
      });
      if (error) throw error;
    } else {
      return NextResponse.json({ ok: false, error: "Unknown event type." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to record event." },
      { status: 500 },
    );
  }
}

function missing(name: string) {
  return NextResponse.json({ ok: false, error: `Missing ${name}.` }, { status: 400 });
}
