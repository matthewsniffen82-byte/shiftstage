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
    if (body.notes !== undefined && body.notes !== "") throw new PublicApiError("INVALID_REQUEST", "VIP requests do not support guest notes.", 400);
    if (!Array.isArray(body.dancerIds) || body.dancerIds.length < 1 || body.dancerIds.length > 10 || typeof body.localStart !== "string") {
      throw new PublicApiError("INVALID_REQUEST", "Choose dancers, a date, and a time.", 400);
    }
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("vip_submit_request", { p_actor: user.id, p_venue: vipId(body.venueId), p_id: vipId(body.requestId), p_local_start: body.localStart, p_dancers: body.dancerIds.map(vipId), p_notes: "" });
    if (error) throw error;
    // In-app alerts were committed atomically with the request. External delivery
    // is optional and must never turn a saved request into a failed submission.
    try { await deliverNotificationRows(admin, data.notifications || []); } catch { console.warn("VIP_OPTIONAL_NOTIFICATION_DELIVERY_FAILED"); }
    return NextResponse.json({ ok: true, request: data.request, session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid VIP request.", tooLargeMessage: "VIP request is too large." });
    if (!Array.isArray(body.dancerIds) || body.dancerIds.length < 1 || body.dancerIds.length > 10 || typeof body.localStart !== "string"
      || typeof body.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt) || !Number.isFinite(Date.parse(body.expectedUpdatedAt))
      || (body.notes !== undefined && body.notes !== "")) {
      throw new PublicApiError("INVALID_REQUEST", "Choose dancers, a date, and a time. Reopen the request if it is out of date.", 400);
    }
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("vip_edit_request", { p_actor: user.id, p_venue: vipId(body.venueId), p_request: vipId(body.requestId),
      p_expected_updated_at: body.expectedUpdatedAt, p_local_start: body.localStart, p_dancers: body.dancerIds.map(vipId) });
    if (error?.code === "40001" && error.message !== "ROSTER_CHANGED") throw new PublicApiError("CONFLICT", "This request or the dancer roster has changed. Return to Requests, refresh, and reopen it. Confirmed visits must be changed through the club.", 409);
    if (error) throw error;
    try { await deliverNotificationRows(admin, data.notifications || []); } catch { console.warn("VIP_OPTIONAL_NOTIFICATION_DELIVERY_FAILED"); }
    return NextResponse.json({ ok: true, request: data.request, changed: data.changed, session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    await createRequestSupabaseContext(request, { role: "customer" });
    // Cached clients must not overwrite the venue's private records.
    throw new PublicApiError("FORBIDDEN", "This account cannot change club records.", 403);
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid request.", tooLargeMessage: "Request is too large." });
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("vip_withdraw_request", {
      p_actor: user.id, p_venue: vipId(body.venueId), p_request: vipId(body.requestId),
    });
    if (error?.code === "40001") throw new PublicApiError("CONFLICT", "This request has already been reviewed. Refresh to see its current status. Contact the club to change a confirmed visit.", 409);
    if (error) throw error;
    try { await deliverNotificationRows(admin, data.notifications || []); } catch { console.warn("VIP_OPTIONAL_NOTIFICATION_DELIVERY_FAILED"); }
    return NextResponse.json({ ok: true, request: data.request, session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const response = apiError(vipError(error), "Unable to load or submit the VIP request.");
  for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
  return response;
}
