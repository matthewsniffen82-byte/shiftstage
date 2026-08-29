import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENT_BODY_BYTES = 4_096;
const MAX_SESSION_ID_LENGTH = 120;
const MAX_SOURCE_LENGTH = 80;
const MAX_NAME_LENGTH = 120;
const MAX_SLUG_LENGTH = 140;
const MAX_CITY_LENGTH = 80;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypes = new Set([
  "profile_view",
  "profile_action",
  "schedule_view",
  "schedule_action",
  "direction_request",
  "social_click",
  "uber_ride_link_clicked",
]);
const socialPlatforms = new Set(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);
const uberRideSources = new Set(["venue_page", "dancer_profile", "tonight_feed"]);

type EventBody = Record<string, unknown>;
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_EVENT_BODY_BYTES,
      invalidMessage: "Invalid event payload.",
      tooLargeMessage: "Event payload is too large.",
    }) as EventBody;
    const client = createAdminSupabaseClient();
    const type = optionalText(body.type, "type", 40);
    const sessionId = optionalSessionId(body.sessionId);

    if (!type) throw invalid("Missing type.");
    if (!eventTypes.has(type)) throw invalid("Unknown event type.");
    await enforcePublicRequestRateLimit(client, {
      namespace: "analytics_events",
      request,
      subject: analyticsRateLimitSubject(type, sessionId, body),
      windowSeconds: 60,
      ipLimit: 120,
      subjectLimit: 300,
    });
    const viewerId = await optionalViewerId(client, request);

    if (type === "profile_view" || type === "profile_action") {
      const dancerId = await resolveDancerId(client, body);
      if (!dancerId) throw invalid("Missing dancerId or dancerName.");
      const source = optionalText(body.source, "source", MAX_SOURCE_LENGTH)
        || (type === "profile_action" ? "profile_action" : "web");
      const { error } = await client.from("profile_views").insert({
        dancer_id: dancerId,
        viewer_id: viewerId,
        source,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (type === "schedule_view" || type === "schedule_action") {
      const dancerId = await resolveDancerId(client, body);
      if (!dancerId) throw invalid("Missing dancerId or dancerName.");
      const { error } = await client.from("schedule_views").insert({
        dancer_id: dancerId,
        shift_id: optionalUuid(body.shiftId, "shiftId"),
        viewer_id: viewerId,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (type === "direction_request") {
      const venueId = await resolveVenueId(client, body);
      if (!venueId) throw invalid("Missing venueId or venueName.");
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
      const platform = optionalText(body.platform, "platform", 24);
      if (!dancerId) throw invalid("Missing dancerId or dancerName.");
      if (!platform || !socialPlatforms.has(platform)) throw invalid("Missing valid platform.");
      const { error } = await client.from("social_clicks").insert({
        dancer_id: dancerId,
        platform,
        clicker_id: viewerId,
        session_id: sessionId,
      });
      if (error) throw error;
    } else if (type === "uber_ride_link_clicked") {
      const venueId = await resolveVenueId(client, body);
      const source = optionalText(body.source, "source", MAX_SOURCE_LENGTH);
      if (!venueId) throw invalid("Missing venueId or venueName.");
      if (!source || !uberRideSources.has(source)) throw invalid("Missing valid source.");
      const dancerId = optionalText(body.dancerId, "dancerId", 64)
        ? await resolveDancerId(client, body)
        : null;
      const timestamp = optionalText(body.timestamp, "timestamp", 64);
      const { error } = await client.from("direction_requests").insert({
        venue_id: venueId,
        dancer_id: dancerId,
        requester_id: viewerId,
        session_id: uberAnalyticsSessionId(source, sessionId, timestamp),
      });
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many analytics requests. Please wait and try again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to record event.");
  }
}

function analyticsRateLimitSubject(type: string, sessionId: string | null, body: EventBody) {
  const target = typeof body.dancerId === "string"
    ? body.dancerId
    : typeof body.venueId === "string"
      ? body.venueId
      : "anonymous";
  return `${type}:${sessionId || target}`.slice(0, 300);
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (normalized.length > maxLength) throw invalid(`Invalid ${label}.`);
  return normalized;
}

function optionalSessionId(value: unknown) {
  const sessionId = optionalText(value, "sessionId", MAX_SESSION_ID_LENGTH);
  if (sessionId && sessionId.length < 8) throw invalid("Invalid sessionId.");
  return sessionId;
}

function optionalUuid(value: unknown, label: string) {
  const id = optionalText(value, label, 64);
  if (id && !UUID_PATTERN.test(id)) throw invalid(`Invalid ${label}.`);
  return id;
}

function uberAnalyticsSessionId(source: string, sessionId: string | null, timestamp: string | null) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  const now = Date.now();
  const eventTime = Number.isFinite(parsed) && Math.abs(parsed - now) <= 24 * 60 * 60 * 1000
    ? new Date(parsed).toISOString()
    : new Date(now).toISOString();
  return `uber_ride_link_clicked:${source}:${sessionId || "anonymous"}:${eventTime}`.slice(0, 240);
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
  const explicitId = optionalUuid(body.dancerId, "dancerId");
  if (explicitId) {
    const { data, error } = await client
      .from("dancer_profiles")
      .select("id")
      .eq("id", explicitId)
      .eq("status", "approved")
      .eq("is_public", true)
      .maybeSingle();
    if (error) throw error;
    return (data as { id?: string } | null)?.id || null;
  }

  const city = optionalText(body.city, "city", MAX_CITY_LENGTH) || "Las Vegas";
  const explicitSlug = optionalText(body.dancerSlug, "dancerSlug", MAX_SLUG_LENGTH);
  const name = optionalText(body.dancerName, "dancerName", MAX_NAME_LENGTH)
    || optionalText(body.profileName, "profileName", MAX_NAME_LENGTH);
  const slug = explicitSlug || (name ? slugify(name) : null);

  if (slug) {
    const { data, error } = await client
      .from("dancer_profiles")
      .select("id")
      .eq("city", city)
      .eq("slug", slug)
      .eq("status", "approved")
      .eq("is_public", true)
      .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  if (name) {
    const { data, error } = await client
      .from("dancer_profiles")
      .select("id")
      .eq("city", city)
      .ilike("stage_name", name)
      .eq("status", "approved")
      .eq("is_public", true)
      .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  return null;
}

async function resolveVenueId(client: AdminClient, body: EventBody) {
  const explicitId = optionalUuid(body.venueId, "venueId");
  if (explicitId) {
    const { data, error } = await client
      .from("venues")
      .select("id")
      .eq("id", explicitId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    return (data as { id?: string } | null)?.id || null;
  }

  const city = optionalText(body.city, "city", MAX_CITY_LENGTH) || "Las Vegas";
  const explicitSlug = optionalText(body.venueSlug, "venueSlug", MAX_SLUG_LENGTH);
  const name = optionalText(body.venueName, "venueName", MAX_NAME_LENGTH);
  const slug = explicitSlug || (name ? slugify(name) : null);

  if (slug) {
    const { data, error } = await client
      .from("venues")
      .select("id")
      .eq("city", city)
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  if (name) {
    const { data, error } = await client
      .from("venues")
      .select("id")
      .eq("city", city)
      .ilike("name", name)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string } | null;
    if (row?.id) return row.id;
  }

  return null;
}

async function optionalViewerId(client: AdminClient, request: Request) {
  const token = getBearerToken(request);
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user?.id || null;
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}
