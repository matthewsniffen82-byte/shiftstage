import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import { resolveVipInvitation, vipTokenDigest, vipError, VIP_HEADERS } from "@/src/lib/dancr/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid confirmation request.", tooLargeMessage: "Confirmation request is too large." });
    const digest = vipTokenDigest(body.token);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicApiError("INVALID_REQUEST", "Enter your invited email.", 400);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "vip_confirmation", request, subject: email, windowSeconds: 600, ipLimit: 8, subjectLimit: 3 });
    await resolveVipInvitation(admin, body.token);
    const { data, error } = await admin.from("venue_vip_invitations").select("id")
      .eq("token_digest", digest).eq("email", email).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (data) {
      const redirect = new URL("/auth/callback", publicAppUrl());
      redirect.searchParams.set("return_to", `/vip/invite/${body.token}`);
      const result = await createServerSupabaseClient().auth.resend({ type: "signup", email, options: { emailRedirectTo: redirect.toString() } });
      if (result.error && Number(result.error.status) === 429) throw new PublicRequestRateLimitError(60);
      // Do not disclose whether an email has an account or is already confirmed.
      if (result.error && (!result.error.status || Number(result.error.status) >= 500)) throw new PublicApiError("UNAVAILABLE", "Email delivery is temporarily unavailable. Please try again shortly.", 503);
    }
    return NextResponse.json({ ok: true, message: "If this invited email is awaiting confirmation, a new link is on the way. Check your inbox and spam folder." }, { headers: VIP_HEADERS });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before requesting another email." }, { status: 429, headers: { ...VIP_HEADERS, "retry-after": String(error.retryAfterSeconds) } });
    const response = apiError(vipError(error), "Unable to send the confirmation email.");
    for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
