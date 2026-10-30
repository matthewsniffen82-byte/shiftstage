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
    if (!access) throw new PublicApiError("FORBIDDEN", "Club access is required.", 403);
    const { data: venue, error: venueError } = await admin.from("venues").select("timezone").eq("id", access.venueId).single();
    if (venueError) throw venueError;
    const window = getTonightWindow(venue.timezone);
    const canManage = access.role === "owner" || access.role === "manager";
    const [{ data, error }, contacts] = await Promise.all([
      admin.rpc("get_venue_operations", { p_venue: access.venueId, p_since: window.startsAt, p_until: window.endsAt }),
      canManage ? admin.rpc("count_venue_customers", { p_venue_id: access.venueId }) : Promise.resolve({ data: null, error: null }),
    ]);
    if (error) throw error;
    if (contacts.error) throw contacts.error;
    const operations = canManage ? { ...data, contactsShared: contacts.data }
      : { ...data, vipPending: null, ridesOpen: null, teamReady: null, contactsShared: null };
    return NextResponse.json({ ok: true, operations, session }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to load tonight’s queues."); }
}
