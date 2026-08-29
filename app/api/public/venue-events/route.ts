import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPES = new Set(["page_view", "qr_impression"]);
const SOURCES = new Set(["venue_page", "dancer_profile"]);
const MAX_EVENT_BODY_BYTES = 2_048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = await readEventBody(request);
    const venueId = readUuid(body.venueId, "Venue id");
    const dancerId = readOptionalUuid(body.dancerId, "Dancer id");
    const eventType = readAllowed(body.eventType, EVENT_TYPES, "Event type");
    const source = readAllowed(body.source, SOURCES, "Source");
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (sessionId.length < 8 || sessionId.length > 120) {
      throw invalid("Valid analytics session is required.");
    }

    const client = createAdminSupabaseClient();
    await requirePublicVenue(client, venueId);
    if (dancerId) await requirePublicDancer(client, dancerId);
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
    return apiError(error, "Unable to record venue analytics.");
  }
}

async function readEventBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EVENT_BODY_BYTES) {
    throw invalid("Event payload is too large.");
  }

  const raw = await request.text();
  if (raw.length > MAX_EVENT_BODY_BYTES) throw invalid("Event payload is too large.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalid("Invalid event payload.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalid("Invalid event payload.");
  }
  return parsed as Record<string, unknown>;
}

function readUuid(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(text)) throw invalid(`${label} is invalid.`);
  return text;
}

function readOptionalUuid(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return readUuid(value, label);
}

function readAllowed(value: unknown, allowed: Set<string>, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!allowed.has(text)) throw invalid(`${label} is invalid.`);
  return text;
}

async function requirePublicVenue(
  client: ReturnType<typeof createAdminSupabaseClient>,
  venueId: string,
) {
  const { data, error } = await client
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw invalid("Venue is unavailable.");
}

async function requirePublicDancer(
  client: ReturnType<typeof createAdminSupabaseClient>,
  dancerId: string,
) {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id")
    .eq("id", dancerId)
    .eq("status", "approved")
    .eq("is_public", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw invalid("Dancer is unavailable.");
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}
