import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";
import { getScheduleDateWindow, getTonightWindow } from "@/src/lib/dancr/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { role: "venue" });
    // Ownership columns are private to the server. Resolve access using the
    // verified user, just like the venue dashboard, before reading guest details.
    const admin = createAdminSupabaseClient();
    const access = await getVenueAccess(admin, context.user.id);
    if (!access?.permissions.includes("view_deals")) throw new PublicApiError("FORBIDDEN", "Club access is required.", 403);
    const params = new URL(request.url).searchParams;
    const search = (params.get("search") || "").trim(), status = params.get("status") || "all", period = params.get("period") || "tonight";
    const offset = Number(params.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new PublicApiError("INVALID_REQUEST", "Invalid guest-list page.", 400);
    if (search.length > 100 || !["all", "generated", "redeemed"].includes(status) || !["active", "tonight", "today", "date"].includes(period)) throw new PublicApiError("INVALID_REQUEST", "Invalid guest filters.", 400);
    const venue = await admin.from("venues").select("timezone").eq("id", access.venueId).single();
    if (venue.error) throw venue.error;
    const timezone = venue.data.timezone || "America/Los_Angeles";
    let window = null;
    if (period !== "active") {
      try {
        window = period === "date" ? getScheduleDateWindow(params.get("date") || "", timezone) : getTonightWindow(timezone);
      } catch {
        throw new PublicApiError("INVALID_REQUEST", "Choose a valid guest-list date.", 400);
      }
    }
    const { data, error } = await admin.rpc("venue_guest_list_workspace", {
      p_venue: access.venueId, p_search: search, p_status: status,
      p_start: window?.startsAt || null, p_end: window?.endsAt || null, p_offset: offset,
    });
    if (error) throw error;
    const entries = (data?.entries || []).map((row: Record<string, string>) => {
      return { id: row.id, name: row.name, phone: row.phone, email: row.email, createdAt: row.created_at,
        expiresAt: row.expires_at, arrivalMethod: row.arrival_method, status: row.status, redeemedAt: row.redeemed_at || null };
    });
    return NextResponse.json({ ok: true, entries, hasMore: data.hasMore, counts: data.counts, timezone,
      updatedAt: new Date().toISOString(), session: context.session || null },
      { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) { return apiError(error, "Unable to load the guest list."); }
}
