import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { clubApprovalHistoryQuery, getClubApprovalHistory, resendClubApproval } from "@/src/lib/dancr/admin-club-approvals";
import { VenueSignupRequestUserError } from "@/src/lib/dancr/venue-signup-requests";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const data = await getClubApprovalHistory(createAdminSupabaseClient(), clubApprovalHistoryQuery(new URL(request.url)));
    return NextResponse.json({ ok: true, ...data, session: session || null }, { headers: HEADERS });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid club link request.", tooLargeMessage: "Invalid club link request." });
    if (body.action !== "resend" || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) {
      throw new PublicApiError("INVALID_REQUEST", "Choose an approved club to resend its link.", 400);
    }
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "admin_club_link_resend", request, subject: body.requestId, windowSeconds: 60, ipLimit: 20, subjectLimit: 1 });
    const result = await resendClubApproval(admin, body.requestId, user.id);
    return NextResponse.json({ ok: true, ...result, session: session || null,
      message: result.delivered ? `Dashboard link sent to ${result.recipient}.${result.historyRecorded ? "" : " The history update is not confirmed; avoid resending again."}`
        : result.deliveryUncertain ? "Email delivery could not be confirmed. Check the club’s inbox before retrying." : "The email could not be sent. Please try again shortly.",
    }, { headers: HEADERS });
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait a minute before resending this club’s link." }, { status: 429, headers: { ...HEADERS, "Retry-After": String(error.retryAfterSeconds) } });
  const response = apiError(error instanceof VenueSignupRequestUserError ? new PublicApiError("INVALID_REQUEST", error.message, 400) : error, "Unable to load approval history or send the club link.");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
