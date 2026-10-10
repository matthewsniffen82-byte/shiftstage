import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { readVipSetupToken, redeemVipSetupLink } from "@/src/lib/dancr/vip-setup-link";
import { VIP_HEADERS, vipError } from "@/src/lib/dancr/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid VIP setup link.", tooLargeMessage: "Invalid VIP setup link." });
    // A manager's invitation token alone never authorizes a guest session.
    const claim = readVipSetupToken(body.link);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "vip_setup_exchange", request, subject: claim.userId, windowSeconds: 600, ipLimit: 20, subjectLimit: 10 });
    return NextResponse.json({ ok: true, ...await redeemVipSetupLink(admin, claim) }, { headers: VIP_HEADERS });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before opening this link again." }, { status: 429, headers: { ...VIP_HEADERS, "retry-after": String(error.retryAfterSeconds) } });
    const response = apiError(vipError(error), "We couldn’t open your VIP setup link. Please try again.");
    for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
