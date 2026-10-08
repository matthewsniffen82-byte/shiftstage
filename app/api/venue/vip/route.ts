import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { getVenueVipState, requireVipManager, newVipToken, VIP_HEADERS, vipError, vipTokenDigest, vipId, vipNickname } from "@/src/lib/dancr/vip";
import { deliverNotificationRows, sendTransactionalEmail } from "@/src/lib/dancr/notification-delivery";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    return NextResponse.json({ ok: true, ...await getVenueVipState(createAdminSupabaseClient(), user.id, new URL(request.url).searchParams), session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const admin = createAdminSupabaseClient(); const access = await requireVipManager(admin, user.id);
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid VIP action.", tooLargeMessage: "VIP action is too large." });
    if (body.action === "set_nickname") {
      const { data, error } = await admin.rpc("vip_set_member_nickname", {
        p_actor: user.id, p_venue: access.venueId, p_member: vipId(body.id), p_nickname: vipNickname(body.nickname),
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, member: data, session }, { headers: VIP_HEADERS });
    }
    const token = body.action === "invite" ? newVipToken() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const { data, error } = await admin.rpc("vip_manage", { p_actor: user.id, p_venue: access.venueId, p_action: body.action,
      p_data: token ? { email, digest: vipTokenDigest(token) } : { id: body.id, status: body.status, expectedStatus: body.expectedStatus, note: body.note } });
    if (error) throw error;
    let invitationUrl = ""; let emailDelivered = false;
    if (token) {
      invitationUrl = `${publicAppUrl()}/vip/invite/${encodeURIComponent(token)}`;
      try {
        const delivery = await sendTransactionalEmail({ to: email, subject: `Your private VIP invitation to ${access.venueName}`,
          text: `You have been invited to VIP access at ${access.venueName}.\n\nCreate an account or sign in with this email, then choose your dancers and request a visit:\n${invitationUrl}\n\nThis private invitation expires in 7 days. Requests are subject to venue confirmation and dancer availability.` });
        emailDelivered = delivery.delivered;
      } catch { console.warn("VIP_INVITATION_EMAIL_UNAVAILABLE"); }
    }
    try { await deliverNotificationRows(admin, data.notifications || []); } catch { console.warn("VIP_OPTIONAL_NOTIFICATION_DELIVERY_FAILED"); }
    return NextResponse.json({ ok: true, invitationUrl, emailDelivered, session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const response = apiError(vipError(error), "Unable to update venue VIP access.");
  for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
  return response;
}
