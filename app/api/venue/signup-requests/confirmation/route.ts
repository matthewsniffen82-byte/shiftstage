import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { sendVenueRequestConfirmation } from "@/src/lib/dancr/venue-email-confirmation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Enter your manager email.", tooLargeMessage: "Request is too large." });
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicApiError("INVALID_REQUEST", "Enter a valid manager email.", 400);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "venue_confirmation", request, subject: email, windowSeconds: 3600, ipLimit: 10, subjectLimit: 3 });
    const pending = await admin.from("venue_signup_requests").select("requester_user_id,login_email")
      .eq("login_email", email).eq("status", "awaiting_email_confirmation").maybeSingle();
    if (pending.error) throw pending.error;
    if (pending.data?.requester_user_id) {
      const result = await sendVenueRequestConfirmation(admin, { userId: pending.data.requester_user_id, email });
      if (!result.delivered && result.reason !== "already_confirmed") throw new PublicApiError("UNAVAILABLE", "Email delivery is temporarily unavailable. Your details are saved; please try again shortly.", 503);
    }
    return NextResponse.json({ ok: true, message: "If this email has a club request awaiting confirmation, a new link is on its way. Check your inbox and spam folder." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait before requesting another confirmation email." }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds), "Cache-Control": "no-store" } });
    return apiError(error, "Unable to send a confirmation email. Please try again shortly.");
  }
}
