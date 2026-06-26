import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { recordDirectionRequest } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const venueId = body?.venueId;
    const dancerIds = Array.isArray(body?.dancerIds) ? body.dancerIds.filter((id: unknown) => typeof id === "string") : [];
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;

    if (!venueId) {
      return NextResponse.json({ ok: false, error: "Missing venueId." }, { status: 400 });
    }

    const directionRequests = await recordDirectionRequest(client, user.id, { venueId, dancerIds, sessionId });

    return NextResponse.json({ ok: true, directionRequests });
  } catch (error) {
    return apiError(error, "Unable to record direction request.");
  }
}
