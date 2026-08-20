import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueDealsForAccount } from "@/src/lib/dancr/deals";
import {
  deleteVenueDealForAccount,
  updateVenueDealForAccount,
} from "@/src/lib/dancr/venue-deal-actions";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const result = await getVenueDealsForAccount(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, deals: result?.deals || [] });
  } catch (error) {
    return apiError(error, "Unable to load the venue Club Deal.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const body = await request.json();
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_deals");
    const { deal, deals } = await updateVenueDealForAccount(
      admin,
      user.id,
      {
        dealId: typeof body?.dealId === "string" ? body.dealId : null,
        dealTitle: typeof body?.dealTitle === "string" ? body.dealTitle : "",
        dealDescription: typeof body?.dealDescription === "string" ? body.dealDescription : "",
        dealTerms: typeof body?.dealTerms === "string" ? body.dealTerms : null,
        isActive: body?.isActive === true,
        offerType: typeof body?.offerType === "string" ? body.offerType : "admission",
        sortOrder: Number(body?.sortOrder || 0),
      },
    );
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: user.id,
      actorRole: access.role,
      action: body?.dealId ? "deal.updated" : "deal.created",
      targetType: "club_deal",
      targetId: deal.id,
      summary: `${deal.dealTitle} was ${deal.isActive ? "published" : "saved as a draft"}.`,
      metadata: { active: deal.isActive, sortOrder: deal.sortOrder },
    });

    console.info("VENUE_CLUB_DEAL_UPDATED", {
      venueId: deal.venueId,
      dealId: deal.id,
      active: deal.isActive,
      referralFeeCents: deal.payoutAmountCents,
    });
    return NextResponse.json({
      ok: true,
      deal,
      deals,
      message: deal.isActive
        ? "Tracked Club Deal published."
        : "Club Deal saved but not published.",
    });
  } catch (error) {
    return apiError(error, "Unable to update the venue Club Deal.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_deals");
    const dealId = new URL(request.url).searchParams.get("dealId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(dealId)) {
      return NextResponse.json({ ok: false, error: "A valid Club Deal is required." }, { status: 400 });
    }
    await deleteVenueDealForAccount(admin, user.id, dealId);
    await recordVenueActivity(admin, { venueId: access.venueId, actorUserId: user.id, actorRole: access.role, action: "deal.deleted", targetType: "club_deal", targetId: dealId, summary: "A Club Deal was deleted." });
    return NextResponse.json({ ok: true, message: "Club Deal deleted." });
  } catch (error) {
    return apiError(error, "Unable to delete the venue Club Deal.", 400);
  }
}
