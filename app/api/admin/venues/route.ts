import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getAdminVenues, requireAdmin, transitionAdminManagedVenuePage, updateAdminVenue } from "@/src/lib/dancr/admin";
import { getAdminVenueClaimCodes } from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_VENUE_ADMIN_BODY_BYTES = 32_768;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const city = new URL(request.url).searchParams.get("city");
    const admin = createAdminSupabaseClient();
    const [venues, claimCodes] = await Promise.all([
      getAdminVenues(admin, city),
      getAdminVenueClaimCodes(admin),
    ]);

    return NextResponse.json({ ok: true, venues, claimCodes, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load admin venues.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    return NextResponse.json({
      ok: false,
      error: "New venues must submit the venue request form. Approve the request to create its private workspace and one-time access code.",
    }, { status: 410 });
  } catch (error) {
    return apiError(error, "Unable to create venue.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_VENUE_ADMIN_BODY_BYTES,
      invalidMessage: "Invalid venue admin request.",
      tooLargeMessage: "Venue admin request is too large.",
    });
    const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : "";

    if (!venueId) {
      return NextResponse.json({ ok: false, error: "Missing venueId." }, { status: 400 });
    }
    if (body?.action === "send_for_review" || body?.action === "publish") {
      const venue = await transitionAdminManagedVenuePage(
        createAdminSupabaseClient(),
        user.id,
        venueId,
        body.action,
      );
      return NextResponse.json({ ok: true, venue, session: session || null });
    }
    if (body?.isActive === true) {
      return NextResponse.json({
        ok: false,
        error: "Use the MyDancr publish action after the connected venue manager approves the prepared page.",
      }, { status: 400 });
    }

    const venue = await updateAdminVenue(createAdminSupabaseClient(), user.id, venueId, body);
    return NextResponse.json({ ok: true, venue, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to update venue.");
  }
}
