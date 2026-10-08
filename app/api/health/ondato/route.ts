import { NextResponse } from "next/server";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { authorizeCronRequest } from "@/src/lib/dancr/cron-auth";
import { inspectOndatoSession, OndatoUnavailableError } from "@/src/lib/dancr/ondato";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex" };

// Manual operator probe, protected by the existing server-only maintenance secret.
// This is deliberately not scheduled and cannot change verification or rollout state.
export async function GET(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    for (const [name, value] of Object.entries(headers)) unauthorized.headers.set(name, value);
    return unauthorized;
  }
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
    const diagnostic = await inspectOndatoSession(createAdminSupabaseClient(), sessionId);
    return NextResponse.json({ ok: true, ...diagnostic }, { headers });
  } catch (error) {
    if (error instanceof OndatoUnavailableError) {
      return NextResponse.json({ ok: false, stage: error.stage, providerStatus: error.providerStatus || null }, { status: 503, headers });
    }
    const status = error instanceof PublicApiError ? error.status : 503;
    return NextResponse.json({ ok: false, error: status === 400 ? "A valid session ID is required."
      : status === 404 ? "Verification session not found." : "Verification diagnostics unavailable." }, { status, headers });
  }
}
