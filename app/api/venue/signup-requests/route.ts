import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createVenueSignupRequest,
  VenueSignupRequestUserError,
} from "@/src/lib/dancr/venue-signup-requests";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { getAccountByUserId, requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueRequestForManager } from "@/src/lib/dancr/venue-request-account";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SIGNUP_REQUEST_BODY_BYTES = 16_384;

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const venueRequest = await getVenueRequestForManager(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, request: venueRequest, session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load your club request.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_SIGNUP_REQUEST_BODY_BYTES,
      invalidMessage: "Invalid venue signup request.",
      tooLargeMessage: "Venue signup request is too large.",
    });

    // A hidden honeypot field absorbs automated submissions without disclosing the filter.
    if (typeof body?.companyFax === "string" && body.companyFax.trim()) {
      return acceptedResponse();
    }

    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "venue_request_signup", request, subject: typeof body.loginEmail === "string" ? body.loginEmail.trim().toLowerCase() : "",
      ipLimit: 10, subjectLimit: 5, windowSeconds: 3600,
    });
    const venueRequest = await createVenueSignupRequest(
      admin,
      body,
      requestIp(request),
    );

    // The request is already durable. A transient sign-in failure must not
    // invite the manager to submit it again or recreate their password.
    let session = null;
    let account = null;
    try {
      const { data, error } = await createServerSupabaseClient().auth.signInWithPassword({
        email: venueRequest.loginEmail!, password: String(body.password || ""),
      });
      if (error) throw error;
      if (data.user?.id !== venueRequest.requesterUserId || !data.session) throw new Error("Unable to start the manager session.");
      account = await getAccountByUserId(admin, data.user.id);
      session = { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at };
    } catch (error) {
      console.warn("VENUE_REQUEST_SESSION_UNAVAILABLE", safeErrorMetadata(error));
    }
    return NextResponse.json(
      {
        ok: true,
        account,
        session,
        request: {
          id: venueRequest.id,
          venueName: venueRequest.venueName,
          status: venueRequest.status,
          submittedAt: venueRequest.submittedAt,
        },
        message: "Your manager login and club request are saved. After approval, use this same login to open your venue dashboard.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json({ ok: false, error: "Too many venue requests. Please try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
    }
    if (error instanceof PublicApiError) {
      return apiError(error, "Unable to submit the venue request.");
    }
    const userMessage = error instanceof VenueSignupRequestUserError ? error.message : "";
    if (!userMessage) console.error("VENUE_SIGNUP_REQUEST_FAILED", safeErrorMetadata(error));
    const status = userMessage.startsWith("Too many venue requests") ? 429 : userMessage ? 400 : 500;
    return apiError(
      userMessage ? new PublicApiError("INVALID_REQUEST", userMessage, status) : error,
      "Unable to submit the venue request.",
      status,
    );
  }
}

function acceptedResponse() {
  return NextResponse.json(
    {
      ok: true,
      message: "Request received. MyDancr will review the venue and contact the business email you provided.",
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || `unknown:${request.headers.get("user-agent")?.slice(0, 160) || "client"}`
  );
}
