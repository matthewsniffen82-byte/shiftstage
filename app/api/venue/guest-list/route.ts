import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { role: "venue" });
    const access = await getVenueAccess(context.client, context.user.id);
    if (!access?.permissions.includes("view_deals")) throw new PublicApiError("FORBIDDEN", "Venue access is required.", 403);
    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new PublicApiError("INVALID_REQUEST", "Invalid guest-list page.", 400);
    const { data, error } = await createAdminSupabaseClient().from("venue_guest_list_entries")
      .select("pass_id, guest_name, phone, email, created_at, qr_redemptions!inner(status, expires_at, arrival_method)")
      .eq("venue_id", access.venueId).gt("qr_redemptions.expires_at", new Date().toISOString())
      .in("qr_redemptions.status", ["generated", "redeemed"])
      .order("created_at", { ascending: false }).order("pass_id").range(offset, offset + 50);
    if (error) throw error;
    const entries = (data || []).slice(0, 50).map(row => {
      const pass = Array.isArray(row.qr_redemptions) ? row.qr_redemptions[0] : row.qr_redemptions;
      return { id: row.pass_id, name: row.guest_name, phone: row.phone, email: row.email, createdAt: row.created_at,
        expiresAt: pass.expires_at, arrivalMethod: pass.arrival_method, status: pass.status };
    });
    return NextResponse.json({ ok: true, entries, hasMore: (data?.length || 0) > 50, session: context.session || null },
      { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) { return apiError(error, "Unable to load the guest list."); }
}
