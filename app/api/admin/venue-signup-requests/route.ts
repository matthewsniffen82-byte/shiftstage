import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminVenueSignupRequests,
  reviewVenueSignupRequest,
  VenueSignupRequestUserError,
} from "@/src/lib/dancr/venue-signup-requests";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SIGNUP_REVIEW_BODY_BYTES = 16_384;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const requests = await getAdminVenueSignupRequests(createAdminSupabaseClient());
    return NextResponse.json(
      { ok: true, requests, session: session || null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("VENUE_SIGNUP_REQUEST_LOAD_FAILED", error);
    return apiError(error, "Unable to load venue signup requests.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_SIGNUP_REVIEW_BODY_BYTES,
      invalidMessage: "Invalid venue signup review request.",
      tooLargeMessage: "Venue signup review request is too large.",
    });
    const decision = body?.decision === "approved" || body?.decision === "rejected"
      ? body.decision
      : "";

    if (!decision) {
      return NextResponse.json(
        { ok: false, error: "Decision must be approved or rejected." },
        { status: 400 },
      );
    }

    const result = await reviewVenueSignupRequest(createAdminSupabaseClient(), {
      requestId: typeof body?.requestId === "string" ? body.requestId : "",
      adminId: user.id,
      decision,
      notes: typeof body?.notes === "string" ? body.notes : null,
      confirmAgentReferral: body?.confirmAgentReferral === true,
    });

    const emailDelivered = result.emailDelivery?.delivered === true;
    return NextResponse.json({
      ok: true,
      ...result,
      message: decision === "approved"
        ? emailDelivered
          ? "Venue approved. The private access code was emailed to the business contact."
          : "Venue approved, but email delivery was unavailable. Copy the private access code now."
        : "Venue request rejected.",
      session: session || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicApiError) {
      return apiError(error, "Unable to review the venue signup request.");
    }
    const userMessage = error instanceof VenueSignupRequestUserError ? error.message : "";
    if (!userMessage) console.error("VENUE_SIGNUP_REQUEST_REVIEW_FAILED", error);
    return apiError(
      new Error(userMessage || "Unable to review the venue signup request."),
      "Unable to review the venue signup request.",
      userMessage ? 400 : 500,
    );
  }
}
