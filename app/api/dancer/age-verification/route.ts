import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getDancerAgeVerification, refreshDancerAgeVerification, startDancerAgeVerification } from "@/src/lib/dancr/didit";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowAgeVerification: true });
    const verification = await getDancerAgeVerification(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, verification, session }, { headers: noStore });
  } catch (error) { return apiError(error, "Unable to load age verification."); }
}

export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer", allowAgeVerification: true });
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "dancer_age_verification", request, subject: user.id,
      windowSeconds: 60, ipLimit: 30, subjectLimit: 6,
    });
    const refresh = new URL(request.url).searchParams.get("action") === "refresh";
    const result = refresh ? { verification: await refreshDancerAgeVerification(admin, user.id) }
      : await startDancerAgeVerification(admin, user.id);
    return NextResponse.json({ ok: true, ...result, session }, { headers: noStore });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, {
      status: 429, headers: { ...noStore, "retry-after": String(error.retryAfterSeconds) },
    });
    return apiError(error, "Unable to start age verification.");
  }
}
