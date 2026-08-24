import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { sendTransactionalEmail } from "@/src/lib/dancr/notification-delivery";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import {
  createVenueTeamInvitation,
  getVenueTeamState,
  revokeVenueTeamInvitation,
  updateVenueTeamMember,
} from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const state = await getVenueTeamState(createAdminSupabaseClient(), user.id);
    return noStore({ ok: true, ...state, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load venue team access.");
  }
}

export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const admin = createAdminSupabaseClient();
    const result = await createVenueTeamInvitation(admin, {
      actorUserId: user.id,
      email: body?.email,
      role: body?.role,
      expiresInDays: 7,
    });
    const invitationUrl = new URL(`/venue-team/invite/${encodeURIComponent(result.token)}`, publicAppUrl()).toString();
    let delivery: { delivered: boolean; reason?: string } = {
      delivered: false,
      reason: "Email delivery was unavailable.",
    };
    try {
      delivery = await sendTransactionalEmail({
        to: result.invitation.email,
        subject: `Join ${result.access.venueName} on MyDancr`,
        text: [
          `You have been invited to join ${result.access.venueName} as ${result.invitation.role}.`,
          "",
          `Accept the secure invitation: ${invitationUrl}`,
          "",
          `This invitation expires ${new Date(result.invitation.expiresAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} Pacific Time.`,
          "If you were not expecting this invitation, you can ignore this email.",
        ].join("\n"),
      });
    } catch (deliveryError) {
      delivery = {
        delivered: false,
        reason: deliveryError instanceof Error ? deliveryError.message : "Email delivery was unavailable.",
      };
    }
    if (!delivery.delivered) {
      console.warn(JSON.stringify({
        event: "venue.team_invitation_delivery_failed",
        venueId: result.access.venueId,
        invitationId: result.invitation.id,
        reason: delivery.reason,
      }));
    }
    return noStore({
      ok: true,
      invitation: result.invitation,
      invitationUrl,
      emailDelivered: delivery.delivered,
      message: delivery.delivered
        ? "Invitation sent."
        : "Invitation created. Copy and send the secure link to the team member.",
      session: session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to invite this venue team member.", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const member = await updateVenueTeamMember(createAdminSupabaseClient(), {
      actorUserId: user.id,
      memberId: body?.memberId,
      role: body?.role,
      remove: body?.remove === true,
    });
    return noStore({ ok: true, member, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to update venue team access.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const body = await request.json();
    await revokeVenueTeamInvitation(createAdminSupabaseClient(), {
      actorUserId: user.id,
      invitationId: body?.invitationId,
    });
    return noStore({ ok: true, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to revoke venue team invitation.", 400);
  }
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
