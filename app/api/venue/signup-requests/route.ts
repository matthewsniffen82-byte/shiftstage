import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createVenueSignupRequest,
  VenueSignupRequestUserError,
} from "@/src/lib/dancr/venue-signup-requests";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SIGNUP_REQUEST_BODY_BYTES = 16_384;

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

    const venueRequest = await createVenueSignupRequest(
      createAdminSupabaseClient(),
      body,
      requestIp(request),
    );

    return NextResponse.json(
      {
        ok: true,
        request: {
          id: venueRequest.id,
          venueName: venueRequest.venueName,
          status: venueRequest.status,
          submittedAt: venueRequest.submittedAt,
        },
        message: "Request received. MyDancr will review the venue and contact the business email you provided.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const userMessage = error instanceof VenueSignupRequestUserError ? error.message : "";
    if (!userMessage) console.error("VENUE_SIGNUP_REQUEST_FAILED", error);
    const status = userMessage.startsWith("Too many venue requests") ? 429 : userMessage ? 400 : 500;
    return apiError(
      new Error(userMessage || "Unable to submit the venue request."),
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
