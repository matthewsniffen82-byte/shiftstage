import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "end_checkins");
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid check-in request.", tooLargeMessage: "Check-in request is too large." });
    if (typeof body.shiftId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.shiftId)) {
      throw new PublicApiError("INVALID_REQUEST", "Choose an active check-in.", 400);
    }
    const { data, error } = await admin.rpc("end_venue_dancer_checkin", {
      p_actor_user_id: user.id, p_venue_id: access.venueId, p_shift_id: body.shiftId,
    });
    if (error) {
      if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "Only this club's active team can end its check-ins.", 403);
      if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "Check-in not found at your club. Refresh the roster.", 404);
      if (error.code === "22023") throw new PublicApiError("CONFLICT", "This check-in cannot be ended. Refresh the roster. Demo sessions are managed centrally.", 409);
      throw error;
    }
    if (data?.shiftId !== body.shiftId || data.venueId !== access.venueId || !Number.isFinite(Date.parse(data.checkedOutAt || ""))) {
      throw new PublicApiError("UNAVAILABLE", "Check-in end could not be confirmed. Refresh before trying again.", 503);
    }
    return NextResponse.json({ ok: true, ...data }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to end this check-in. Refresh and try again."); }
}
