import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  AccountRecoveryRateLimitError,
  enforceAccountRecoveryRateLimit,
} from "@/src/lib/dancr/account-recovery";
import {
  resolveVenueSignupCode,
  VenueClaimUserError,
} from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ACCESS_CODE_BODY_BYTES = 2_048;

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_ACCESS_CODE_BODY_BYTES,
      invalidMessage: "Invalid venue access request.",
      tooLargeMessage: "Venue access request is too large.",
    });
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!code || code.length > 256) {
      return NextResponse.json({ ok: false, error: "Enter the private venue access code from MyDancr." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    await enforceAccountRecoveryRateLimit(admin, {
      eventType: "venue_access_preview",
      role: "venue",
      request,
      subject: code,
    });
    const access = await resolveVenueSignupCode(admin, code);

    return NextResponse.json({
      ok: true,
      venue: {
        id: access.venue.id,
        slug: access.venue.slug,
        name: access.venue.name,
        city: access.venue.city,
        state: access.venue.state,
      },
    });
  } catch (error) {
    if (error instanceof PublicApiError) {
      return apiError(error, "Unable to verify this venue access code.");
    }
    if (error instanceof AccountRecoveryRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many access-code checks. Wait a few minutes, then try again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof VenueClaimUserError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error(JSON.stringify({
      event: "venue_access.preview_failed",
      ...safeErrorMetadata(error),
    }));
    return apiError(new Error("Unable to verify this venue access code."), "Unable to verify this venue access code.");
  }
}
