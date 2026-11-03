import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { staffFactors, staffMfaAction, staffSessionSecurity } from "@/src/lib/dancr/staff-mfa";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };
function failure(error: unknown) {
  if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
  const response = apiError(error, "Unable to complete staff security. Refresh before retrying.");
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "workspace");
    const security = await staffSessionSecurity(client);
    return NextResponse.json({ ok: true, userId: user.id, ...security, factors: staffFactors(user), session }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOriginJsonMutation(request);
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id, "workspace");
    if (!session?.refreshToken) throw new PublicApiError("AUTH_REQUIRED", "Sign in again before setting up your authenticator.", 401);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid security request.", tooLargeMessage: "Security request is too large." });
    await enforcePublicRequestRateLimit(createAdminSupabaseClient(), { namespace: "staff_mfa", request, subject: user.id, windowSeconds: 300, ipLimit: 80, subjectLimit: 20 });
    const result = await staffMfaAction(client, user, body);
    const current = await client.auth.getSession();
    if (current.error || !current.data.session) throw new PublicApiError("AUTH_REQUIRED", "Sign in again to continue.", 401);
    const fresh = current.data.session;
    return NextResponse.json({ ok: true, userId: user.id, ...result, session: { accessToken: fresh.access_token, refreshToken: fresh.refresh_token, expiresAt: fresh.expires_at } }, { headers });
  } catch (error) { return failure(error); }
}
