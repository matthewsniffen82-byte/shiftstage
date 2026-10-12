import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";
import { getTonightWindow } from "@/src/lib/dancr/schedule";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const admin = createAdminSupabaseClient();
    const access = await getVenueAccess(admin, user.id);
    if (!access) throw new PublicApiError("FORBIDDEN", "Venue access is required.", 403);
    const { data: venue, error: venueError } = await admin.from("venues").select("timezone").eq("id", access.venueId).single();
    if (venueError) throw venueError;
    const window = getTonightWindow(venue.timezone);
    const { data, error } = await admin.rpc("get_venue_operations", { p_venue: access.venueId, p_since: window.startsAt, p_until: window.endsAt });
    if (error) throw error;
    const operations = access.role === "staff" ? { ...data, vipPending: null, ridesOpen: null, teamReady: null } : data;
    return NextResponse.json({ operations, session }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load tonight’s queues."); }
}
