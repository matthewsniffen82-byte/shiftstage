import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  deleteVenueDealForAccount,
  getVenueDealsForAccount,
  updateVenueDealForAccount,
} from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenue(client, user.id);
    const result = await getVenueDealsForAccount(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, deals: result?.deals || [] });
  } catch (error) {
    return apiError(error, "Unable to load the venue Club Deal.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenue(client, user.id);
    const body = await request.json();
    const referralCommissionCents = Number(body?.referralCommissionCents);
    const { deal, deals } = await updateVenueDealForAccount(
      createAdminSupabaseClient(),
      user.id,
      {
        dealId: typeof body?.dealId === "string" ? body.dealId : null,
        dealTitle: typeof body?.dealTitle === "string" ? body.dealTitle : "",
        dealDescription: typeof body?.dealDescription === "string" ? body.dealDescription : "",
        dealTerms: typeof body?.dealTerms === "string" ? body.dealTerms : null,
        referralCommissionCents,
        isActive: body?.isActive === true,
        offerType: typeof body?.offerType === "string" ? body.offerType : "admission",
        bookingUrl: typeof body?.bookingUrl === "string" ? body.bookingUrl : null,
        sortOrder: Number(body?.sortOrder || 0),
      },
    );

    console.info("VENUE_CLUB_DEAL_UPDATED", {
      venueId: deal.venueId,
      dealId: deal.id,
      active: deal.isActive,
      referralCommissionCents: deal.payoutAmountCents,
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
    await requireActiveVenue(client, user.id);
    const dealId = new URL(request.url).searchParams.get("dealId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(dealId)) {
      return NextResponse.json({ ok: false, error: "A valid Club Deal is required." }, { status: 400 });
    }
    await deleteVenueDealForAccount(createAdminSupabaseClient(), user.id, dealId);
    return NextResponse.json({ ok: true, message: "Club Deal deleted." });
  } catch (error) {
    return apiError(error, "Unable to delete the venue Club Deal.", 400);
  }
}

async function requireActiveVenue(
  client: Parameters<typeof getAccountByUserId>[0],
  userId: string,
) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "venue" || account.accountState !== "active") {
    throw new Error("Active venue account required.");
  }
}
