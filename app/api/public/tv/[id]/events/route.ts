import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import {
  MYDANCR_TV_EVENT_SOURCES,
  MYDANCR_TV_EVENT_TYPES,
  recordMyDancrTvEvent,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

const MAX_TV_EVENT_BODY_BYTES = 2_048;

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV video." }, { status: 400 });
    }
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_TV_EVENT_BODY_BYTES,
      invalidMessage: "Invalid MyDancr TV event payload.",
      tooLargeMessage: "MyDancr TV event is too large.",
    });
    const eventType = typeof body?.eventType === "string" ? body.eventType : "";
    const source = typeof body?.source === "string" ? body.source : "tv_feed";
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!MYDANCR_TV_EVENT_TYPES.has(eventType) || !MYDANCR_TV_EVENT_SOURCES.has(source)) {
      return NextResponse.json({ ok: false, error: "Invalid MyDancr TV event." }, { status: 400 });
    }
    if (sessionId.length < 8 || sessionId.length > 120) {
      return NextResponse.json({ ok: false, error: "Invalid viewer session." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "tv_events",
      request,
      subject: `${id}:${eventType}:${sessionId}`,
      windowSeconds: 60,
      ipLimit: 180,
      subjectLimit: 20,
    });
    const viewerId = await optionalViewerId(admin, request);
    const result = await recordMyDancrTvEvent(admin, {
      videoId: id,
      viewerId,
      sessionId,
      eventType,
      source,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many MyDancr TV activity requests. Please wait and try again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to record MyDancr TV activity.");
  }
}

async function optionalViewerId(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  request: Request,
) {
  const token = getBearerToken(request);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id || null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
