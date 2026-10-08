import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";
import type { VenueCustomer } from "@/src/lib/dancr/venue-customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const admin = createAdminSupabaseClient();
    const access = await getVenueAccess(admin, user.id);
    if (!access || !["owner", "manager"].includes(access.role))
      throw new PublicApiError("FORBIDDEN", "Only club owners and managers can open the customer list.", 403);
    const params = new URL(request.url).searchParams;
    const source = params.get("source") || "all", offset = Number(params.get("offset") || 0);
    if (!["all", "followers", "guests"].includes(source) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw new PublicApiError("INVALID_REQUEST", "Invalid customer list page.", 400);
    const { data, error } = await admin.rpc("get_venue_customers", { p_venue_id: access.venueId, p_source: source, p_offset: offset });
    if (error) throw error;
    const rows = (data || []) as VenueCustomer[];
    const entries = rows.slice(0, 50).map(({ id, name, email, phone, city, joined_at, is_follower, is_guest }) =>
      ({ id, name, email, phone, city, joined_at, is_follower, is_guest }));
    return NextResponse.json({ ok: true, entries, hasMore: rows.length > 50, session }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) { return apiError(error, "Unable to load customers."); }
}
