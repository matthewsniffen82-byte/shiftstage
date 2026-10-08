import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { getVipState, VIP_HEADERS, vipError, vipId } from "@/src/lib/dancr/vip";
import { deliverNotificationRows } from "@/src/lib/dancr/notification-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    return NextResponse.json({ ok: true, ...await getVipState(createAdminSupabaseClient(), user.id, new URL(request.url).searchParams), session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid VIP request.", tooLargeMessage: "VIP request is too large." });
    if (!Array.isArray(body.dancerIds) || body.dancerIds.length < 1 || body.dancerIds.length > 10 || typeof body.localStart !== "string" || typeof body.notes !== "string") {
      throw new PublicApiError("INVALID_REQUEST", "Choose dancers, a date, and a time.", 400);
    }
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("vip_submit_request", { p_actor: user.id, p_venue: vipId(body.venueId), p_id: vipId(body.requestId), p_local_start: body.localStart, p_dancers: body.dancerIds.map(vipId), p_notes: body.notes });
    if (error) throw error;
    // In-app alerts were committed atomically with the request. External delivery
    // is optional and must never turn a saved request into a failed submission.
    try { await deliverNotificationRows(admin, data.notifications || []); } catch { console.warn("VIP_OPTIONAL_NOTIFICATION_DELIVERY_FAILED"); }
    return NextResponse.json({ ok: true, request: data.request, session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const response = apiError(vipError(error), "Unable to load or submit the VIP request.");
  for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
  return response;
}
