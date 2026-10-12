import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getVenueAccess } from "@/src/lib/dancr/venue-access";
import { pickupUuid } from "@/src/lib/dancr/pickup-validation";
import { RIDE_STATUSES } from "@/src/lib/dancr/venue-operations";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const admin = createAdminSupabaseClient(), access = await getVenueAccess(admin, user.id);
    if (!access || !["owner", "manager"].includes(access.role)) throw new PublicApiError("FORBIDDEN", "Only club owners and managers can update rides.", 403);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid ride update.", tooLargeMessage: "Ride update is too large." });
    if (typeof body.status !== "string" || !Object.hasOwn(RIDE_STATUSES, body.status) || typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 0)
      throw new PublicApiError("INVALID_REQUEST", "Choose a valid ride status and refresh the request.", 400);
    const { data, error } = await admin.rpc("set_venue_ride_status", { p_actor: user.id, p_venue: access.venueId, p_request: pickupUuid(body.id), p_status: body.status, p_version: body.version });
    if (error?.code === "40001") throw new PublicApiError("CONFLICT", "Another staff member updated this ride. Refresh before trying again.", 409);
    if (error) throw error;
    return NextResponse.json({ ok: true, ride: data, session }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to update this ride."); }
}
