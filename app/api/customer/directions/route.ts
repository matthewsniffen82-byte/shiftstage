import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { recordDirectionRequest } from "@/src/lib/dancr/customer";
import { requirePublicDancersAtVenue } from "@/src/lib/dancr/resource-authorization";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTRIBUTED_DANCERS = 20;
const MAX_SESSION_ID_LENGTH = 160;
const MAX_DIRECTION_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_DIRECTION_BODY_BYTES,
      invalidMessage: "Invalid direction request.",
      tooLargeMessage: "Direction request is too large.",
    });
    const venueId = body?.venueId;
    const submittedDancerIds = Array.isArray(body?.dancerIds) ? body.dancerIds : [];
    const dancerIds = submittedDancerIds.filter(
      (id: unknown): id is string => typeof id === "string" && UUID_PATTERN.test(id),
    );
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : null;

    if (typeof venueId !== "string" || !UUID_PATTERN.test(venueId)) {
      return NextResponse.json({ ok: false, error: "Invalid venueId." }, { status: 400 });
    }

    if (submittedDancerIds.length > MAX_ATTRIBUTED_DANCERS || dancerIds.length !== submittedDancerIds.length) {
      return NextResponse.json({ ok: false, error: "Invalid dancerIds." }, { status: 400 });
    }

    if (sessionId && sessionId.length > MAX_SESSION_ID_LENGTH) {
      return NextResponse.json({ ok: false, error: "Invalid sessionId." }, { status: 400 });
    }

    await requirePublicDancersAtVenue(createAdminSupabaseClient(), venueId, dancerIds);
    const directionRequests = await recordDirectionRequest(client, user.id, { venueId, dancerIds, sessionId });

    return NextResponse.json({ ok: true, directionRequests });
  } catch (error) {
    return apiError(error, "Unable to record direction request.");
  }
}
