import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const socialPlatforms = new Set(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);

type EventBody = Record<string, unknown>;
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EventBody;
    const client = createAdminSupabaseClient();
    const type = text(body.type);
    const sessionId = text(body.sessionId);
    const viewerId = text(body.viewerId);

    if (!type) return missing("type");

    if (type === "profile_view" || type === "profile_action") {
      const dancerId = await resolveDancerId(client, body);
      if (!dancerId) return missing("dancerId or dancerName");
      const { error } = await client.from("profile_views").insert({
        dancer_id: dancerId,
        viewer_id: viewerId,
        source: text(body.source) || (type === "profile_action" ? "profile_action" : "web"),
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (type === "schedule_view" || type === "schedule_action") {
      const dancerId = await resolveDancerId(client, body);
      if (!dancerId) return missing("dancerId or dancerName");
      const { error } = await client.from("schedule_views").insert({
        dancer_id: dancerId,
        shift_id: text(body.shiftId),
        viewer_id: viewerId,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (type === "direction_request") {
      const venueId = await resolveVenueId(client, body);
      if (!venueId) return missing("venueId or venueName");
      const dancerId = await resolveDancerId(client, body);
      const { error } = await client.from("direction_requests").insert({
        dancer_id: dancerId,
        venue_id: venueId,
        requester_id: viewerId,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (type === "social_click") {
      const dancerId = await resolveDancerId(client, body);
      const platform = text(body.platform);
      if (!dancerId) return missing("dancerId or dancerName");
      if (!platform || !socialPlatforms.has(platform)) return missing("valid platform");
      const { error } = await client.from("social_clicks").insert({
        dancer_id: dancerId,
        platform,
        clicker_id: viewerId,
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

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveDancerId(client: AdminClient, body: EventBody) {
  const explicitId = text(body.dancerId);
  if (explicitId) return explicitId;

  const city = text(body.city) || "Las Vegas";
  const explicitSlug = text(body.dancerSlug);
  const name = text(body.dancerName) || text(body.profileName);
  const slug = explicitSlug || (name ? slugify(name) : null);

  if (slug) {
    const { data } = await client
      .from("dancer_profiles")
      .select("id")
      .eq("city", city)
      .eq("slug", slug)
      .eq("status", "approved")
      .eq("is_public", true)
      .maybeSingle();
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  if (name) {
    const { data } = await client
      .from("dancer_profiles")
      .select("id")
      .eq("city", city)
      .ilike("stage_name", name)
      .eq("status", "approved")
      .eq("is_public", true)
      .maybeSingle();
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  return null;
}

async function resolveVenueId(client: AdminClient, body: EventBody) {
  const explicitId = text(body.venueId);
  if (explicitId) return explicitId;

  const city = text(body.city) || "Las Vegas";
  const explicitSlug = text(body.venueSlug);
  const name = text(body.venueName);
  const slug = explicitSlug || (name ? slugify(name) : null);

  if (slug) {
    const { data } = await client
      .from("venues")
      .select("id")
      .eq("city", city)
      .eq("slug", slug)
      .maybeSingle();
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  if (name) {
    const { data } = await client
      .from("venues")
      .select("id")
      .eq("city", city)
      .ilike("name", name)
      .maybeSingle();
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  return null;
}

function missing(name: string) {
  return NextResponse.json({ ok: false, error: `Missing ${name}.` }, { status: 400 });
}
