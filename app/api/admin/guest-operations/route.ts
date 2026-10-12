import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { adminGuestAction, getAdminGuestOperations } from "@/src/lib/dancr/admin-guest-operations";
import { newVipToken, vipTokenDigest } from "@/src/lib/dancr/vip";
import { deliverNotificationRows } from "@/src/lib/dancr/notification-delivery";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import { sendVipInvitationEmail } from "@/src/lib/dancr/vip-setup-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };
function failure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  let mapped = error;
  if (code === "42501") mapped = new PublicApiError("FORBIDDEN", "Active admin access is required.", 403);
  if (code === "P0002") mapped = new PublicApiError("NOT_FOUND", "This club or guest record is no longer available.", 404);
  if (code === "40001") mapped = new PublicApiError("CONFLICT", "This record changed. Refresh to see its current state.", 409);
  if (code === "P0001") mapped = new PublicApiError("INVALID_REQUEST", "This action could not be completed. Refresh before trying again.", 400);
  if (["22023", "22007", "22008", "22P02", "23514"].includes(code)) mapped = new PublicApiError("INVALID_REQUEST", "Check the guest action details and try again.", 400);
  const response = apiError(mapped, "Unable to load or update guest operations.");
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const data = await getAdminGuestOperations(createAdminSupabaseClient(), new URL(request.url).searchParams);
    return NextResponse.json({ ok: true, ...data, session }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid guest action.", tooLargeMessage: "Guest action is too large." });
    const { venueId, action, data } = adminGuestAction(body);
    const admin = createAdminSupabaseClient();
    const token = action === "invite" ? newVipToken() : "";
    if (token) data.digest = vipTokenDigest(token);
    const result = await admin.rpc("admin_guest_operation", { p_actor: user.id, p_venue: venueId, p_action: action, p_data: data });
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Guest action could not be confirmed.");
    let deliveryWarning = "", invitationUrl = "";
    if (token) {
      invitationUrl = `${publicAppUrl()}/vip/invite/${encodeURIComponent(token)}`;
      try {
        const venue = await admin.from("venues").select("name").eq("id", venueId).single();
        if (venue.error || !await sendVipInvitationEmail(admin, { invitation: token, email: String(data.email), venueName: venue.data.name })) throw new Error("Delivery unavailable");
      } catch { deliveryWarning = "Invitation saved. Email delivery could not be confirmed; use the invitation link below."; }
    }
    if (result.data.notifications?.length) {
      try { await deliverNotificationRows(admin, result.data.notifications); }
      catch { deliveryWarning = "Change saved and in-app alerts recorded. External notification delivery could not be confirmed."; }
    }
    // Private notification recipients and internal labels never appear in the response.
    return NextResponse.json({ ok: true, session, invitationUrl, deliveryWarning }, { headers });
  } catch (error) { return failure(error); }
}
