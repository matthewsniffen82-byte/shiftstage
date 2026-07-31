import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  getVenueDealForAccount,
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
    const result = await getVenueDealForAccount(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, deal: result?.deal || null });
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
    const deal = await updateVenueDealForAccount(
      createAdminSupabaseClient(),
      user.id,
      {
        dealTitle: typeof body?.dealTitle === "string" ? body.dealTitle : "",
        dealDescription: typeof body?.dealDescription === "string" ? body.dealDescription : "",
        dealTerms: typeof body?.dealTerms === "string" ? body.dealTerms : null,
        referralCommissionCents,
        isActive: body?.isActive === true,
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
      message: deal.isActive
        ? "Tracked Club Deal published."
        : "Club Deal saved but not published.",
    });
  } catch (error) {
    return apiError(error, "Unable to update the venue Club Deal.", 400);
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
