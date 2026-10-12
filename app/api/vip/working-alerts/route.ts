import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { VIP_HEADERS, vipError, vipId } from "@/src/lib/dancr/vip";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "vip_working_alert", request, subject: user.id,
      windowSeconds: 60, ipLimit: 180, subjectLimit: 90 });
    const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid alert preference.", tooLargeMessage: "Alert preference is too large." });
    if (typeof body.enabled !== "boolean") throw new PublicApiError("INVALID_REQUEST", "Choose on or off for working alerts.", 400);
    const { data, error } = await admin.rpc("vip_set_working_alert", {
      p_actor: user.id, p_venue: vipId(body.venueId), p_dancer: vipId(body.dancerId), p_enabled: body.enabled,
    });
    if (error?.code === "40001") throw new PublicApiError("CONFLICT", "Working alerts are unavailable for this dancer at this club. Refresh and try again.", 409);
    if (error) throw error;
    return NextResponse.json({ ok: true, enabled: data === true, session }, { headers: VIP_HEADERS });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, {
      status: 429, headers: { ...VIP_HEADERS, "retry-after": String(error.retryAfterSeconds) },
    });
    const response = apiError(vipError(error), "Unable to update working alerts.");
    for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
