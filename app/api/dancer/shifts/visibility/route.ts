import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "dancer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 2048,
      invalidMessage: "Invalid shift request.", tooLargeMessage: "Shift request is too large." });
    const shiftId = typeof body.shiftId === "string" ? body.shiftId : "";
    if (Object.keys(body).length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shiftId)) {
      throw new PublicApiError("INVALID_REQUEST", "Choose an active shift to switch to Both.", 400);
    }
    const { data, error } = await createAdminSupabaseClient().rpc("enable_dancer_shift_both", {
      p_dancer_user_id: user.id, p_shift_id: shiftId,
    });
    if (error?.code === "42501") throw new PublicApiError("FORBIDDEN", "Your account, profile, age verification and club access must be approved to switch to Both.", 403);
    if (error?.code === "P0002") throw new PublicApiError("NOT_FOUND", "This shift is no longer available.", 404);
    if (error?.code === "40001") throw new PublicApiError("CONFLICT", "Your check-in changed. Refresh the dashboard. You can switch only during an active Internal shift.", 409);
    if (error || data?.shiftId !== shiftId.toLowerCase() || data?.visibility !== "both"
      || typeof data.changed !== "boolean" || typeof data.isPublic !== "boolean"
      || typeof data.workingUntil !== "string" || !Number.isFinite(Date.parse(data.workingUntil))) {
      throw new PublicApiError("UNAVAILABLE", "The switch could not be confirmed. Refresh your dashboard before trying again.", 503);
    }
    return NextResponse.json({ ok: true, ...data, session }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to switch to Both."); }
}
