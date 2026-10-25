import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { readVenueApprovalToken, redeemVenueApprovalLink, VENUE_APPROVAL_HEADERS } from "@/src/lib/dancr/venue-approval-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid club approval link.", tooLargeMessage: "Invalid club approval link." });
    const claim = readVenueApprovalToken(body.link);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "venue_approval_login", request, subject: claim.userId, windowSeconds: 600, ipLimit: 20, subjectLimit: 10 });
    return NextResponse.json({ ok: true, ...await redeemVenueApprovalLink(admin, claim) }, { headers: VENUE_APPROVAL_HEADERS });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before opening this link again." }, { status: 429, headers: { ...VENUE_APPROVAL_HEADERS, "retry-after": String(error.retryAfterSeconds) } });
    const response = apiError(error, "We couldn’t open your Club dashboard. Please try the email link again.");
    for (const [key, value] of Object.entries(VENUE_APPROVAL_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
