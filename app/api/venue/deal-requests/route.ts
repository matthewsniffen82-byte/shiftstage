import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  createVenueClubDealRequest,
  getVenueClubDealRequests,
} from "@/src/lib/dancr/venue-deal-requests";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "view_deals");
    const requests = await getVenueClubDealRequests(admin, access.venueId);
    return noStore({ ok: true, requests, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load Club Deal requests.");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await createRequestSupabaseContext(request);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, auth.user.id, "request_deals");
    const dealRequest = await createVenueClubDealRequest(admin, {
      venueId: access.venueId,
      requestedByUserId: auth.user.id,
      offerKey: typeof body.offerKey === "string" ? body.offerKey : "",
      requestNotes: typeof body.requestNotes === "string" ? body.requestNotes : null,
    });
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: auth.user.id,
      actorRole: access.role,
      action: "deal.requested",
      targetType: "club_deal_request",
      targetId: dealRequest.id,
      summary: `${dealRequest.offerTitle} was requested for MyDancr contract review.`,
      metadata: { offerKey: dealRequest.offerKey },
    });
    const requests = await getVenueClubDealRequests(admin, access.venueId);
    console.info("VENUE_CLUB_DEAL_REQUESTED", {
      venueId: access.venueId,
      requestId: dealRequest.id,
      requestedByUserId: auth.user.id,
    });
    return noStore({
      ok: true,
      dealRequest,
      requests,
      message: "Club Deal request sent to MyDancr for contract review.",
      session: auth.session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to send this Club Deal request.", 400);
  }
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
