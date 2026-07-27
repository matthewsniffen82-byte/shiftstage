import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPES = new Set(["page_view", "qr_impression"]);
const SOURCES = new Set(["venue_page", "dancer_profile"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const venueId = readUuid(body.venueId, "Venue id");
    const dancerId = body.dancerId ? readUuid(body.dancerId, "Dancer id") : null;
    const eventType = readAllowed(body.eventType, EVENT_TYPES, "Event type");
    const source = readAllowed(body.source, SOURCES, "Source");
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (sessionId.length < 8 || sessionId.length > 120) {
      return NextResponse.json({ ok: false, error: "Valid analytics session is required." }, { status: 400 });
    }

    const client = createAdminSupabaseClient();
    const { error } = await client.from("venue_page_events").upsert(
      {
        venue_id: venueId,
        dancer_id: dancerId,
        event_type: eventType,
        source,
        session_id: sessionId,
      },
      {
        onConflict: "venue_id,event_type,source,session_id,occurred_on",
        ignoreDuplicates: true,
      },
    );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to record venue analytics.", 400);
  }
}

function readUuid(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function readAllowed(value: unknown, allowed: Set<string>, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!allowed.has(text)) throw new Error(`${label} is invalid.`);
  return text;
}
