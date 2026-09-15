import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { pickupAccountRole, pickupRpc } from "@/src/lib/dancr/pickup-server";
import { pickupUuid } from "@/src/lib/dancr/pickup-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { active: true });
    await pickupAccountRole(context.client);
    const venues = await pickupRpc(context.client, "pickup_manageable_venues");
    return NextResponse.json({ ok: true, venues, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to load pickup settings."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
export async function POST(request: Request) {
  try {
    const context = await createRequestSupabaseContext(request, { role: "venue" });
    const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid pickup setting.", tooLargeMessage: "Pickup setting is too large." });
    if (typeof body.enabled !== "boolean" || Object.keys(body).some(key => !["venueId", "enabled"].includes(key))) throw new PublicApiError("INVALID_REQUEST", "Invalid pickup setting.", 400);
    await pickupRpc(context.client, "pickup_set_enabled", { p_venue_id: pickupUuid(body.venueId), p_enabled: body.enabled });
    return NextResponse.json({ ok: true, session: context.session }, { headers });
  } catch (error) { const response = apiError(error, "Unable to update pickup setting."); response.headers.set("cache-control", headers["cache-control"]); return response; }
}
