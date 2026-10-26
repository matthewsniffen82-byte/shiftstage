import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { sendPendingAccountEmail } from "@/src/lib/dancr/email-actions";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer" };

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Enter your account email.", tooLargeMessage: "Request is too large." });
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new PublicApiError("INVALID_REQUEST", "Enter a valid email address.", 400);
    }
    await enforcePublicRequestRateLimit(createAdminSupabaseClient(), {
      namespace: "signup_confirmation", request, subject: email, windowSeconds: 600, ipLimit: 8, subjectLimit: 3,
    });
    // Resend only: never create an account, revive a deleted identity, or change
    // its role/preferences. The verified identity determines the destination.
    await sendPendingAccountEmail(createAdminSupabaseClient(), email, "confirmation");
    // Unknown and already-confirmed emails get the same response.
    return NextResponse.json({ ok: true, message: "If this email is awaiting confirmation, a link is on its way. Check your inbox and spam folder." }, { headers });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json({ ok: false, error: "Please wait before requesting another confirmation email." }, {
        status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) },
      });
    }
    const response = apiError(error, "Unable to send a confirmation email. Please try again shortly.");
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}
