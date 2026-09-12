import { after, NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { normalizeShuttleRequest } from "@/src/lib/dancr/club-deal-transportation";
import { submitClubShuttleRequest } from "@/src/lib/dancr/club-shuttle-requests";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ dealId: string }> }) {
  try {
    requireSameOriginJsonMutation(request);
    const { dealId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId)) throw new PublicApiError("INVALID_REQUEST", "Choose a valid Club Deal.", 400);
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid shuttle request.", tooLargeMessage: "Shuttle request is too large." });
    const details = normalizeShuttleRequest(body);
    if (!details) throw new PublicApiError("INVALID_REQUEST", "Complete all shuttle request fields and accept the club handoff.", 400);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "club_shuttle", request, subject: details.phone,
      ipLimit: 10, subjectLimit: 5, windowSeconds: 3600 });
    const result = await submitClubShuttleRequest(admin, dealId, body, after);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Too many shuttle requests. Please try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to send your shuttle request. Please try again later.");
  }
}
