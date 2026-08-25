import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { getActiveClubDealsForVenue } from "@/src/lib/dancr/deals";
import { getVenueById, getVenuePublicationState } from "@/src/lib/dancr/venue";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const venueId = new URL(request.url).searchParams.get("venueId")?.trim() || "";
    if (!venueId) {
      return NextResponse.json({ ok: false, error: "Missing venueId." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const [profile, deals] = await Promise.all([
      getVenueById(admin, venueId),
      getActiveClubDealsForVenue(admin, venueId),
    ]);

    return NextResponse.json({
      ok: true,
      profile,
      deal: deals[0] || null,
      deals,
      publication: getVenuePublicationState(profile, deals),
    });
  } catch (error) {
    return apiError(error, "Unable to load the Admin venue preview.");
  }
}
