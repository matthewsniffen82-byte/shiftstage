import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { requirePublicVenue, requirePublicDancer } from "@/src/lib/dancr/resource-authorization";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { VENUE_INTERACTION_TYPES, VENUE_INTERACTION_SOURCES } from "@/src/lib/dancr/venue-analytics";
import { readVenueVideo } from "@/src/lib/dancr/venue-video-attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid event.", tooLargeMessage: "Event is too large." });
    const { eventId, venueId, dancerId, eventType, source, sessionId } = body;
    if (typeof eventId !== "string" || !UUID.test(eventId) || typeof venueId !== "string" || !UUID.test(venueId)
      || (dancerId != null && (typeof dancerId !== "string" || !UUID.test(dancerId)))
      || typeof eventType !== "string" || !VENUE_INTERACTION_TYPES.includes(eventType)
      || typeof source !== "string" || !VENUE_INTERACTION_SOURCES.includes(source)
      || typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 120) {
      throw new PublicApiError("INVALID_REQUEST", "Invalid venue interaction.", 400);
    }
    const client = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(client, { namespace: "venue_interactions", request, subject: `${venueId}:${sessionId}`, windowSeconds: 60, ipLimit: 180, subjectLimit: 90 });
    await requirePublicVenue(client, venueId);
    if (dancerId) {
      await requirePublicDancer(client, dancerId as string);
      const { data: affiliation, error } = await client.from("venue_dancer_affiliations").select("id").eq("venue_id", venueId).eq("dancer_id", dancerId).eq("status", "active").maybeSingle();
      if (error) throw error;
      if (!affiliation) throw new PublicApiError("NOT_FOUND", "Dancer is not affiliated with this venue.", 404);
    }
    const videoId = readVenueVideo(request, venueId, process.env.DANCR_PUBLIC_RATE_LIMIT_SECRET);
    const { error } = await client.from("venue_interactions").upsert({ id: eventId, venue_id: venueId, dancer_id: dancerId || null, video_id: videoId, event_type: eventType, source, session_id: sessionId }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Too many analytics requests." }, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to record venue interaction.");
  }
}
