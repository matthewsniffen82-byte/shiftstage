import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminDealActivity,
  settleDealRevenueEvent,
  voidDealRedemption,
} from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const params = new URL(request.url).searchParams;
    const activity = await getAdminDealActivity(createAdminSupabaseClient(), {
      venueId: params.get("venueId"),
      dancerId: params.get("dancerId"),
      dealId: params.get("dealId"),
      sourceType: params.get("sourceType"),
      status: params.get("status"),
      commissionStatus: params.get("commissionStatus"),
      suspicious: params.get("suspicious"),
    });

    return NextResponse.json({ ok: true, activity });
  } catch (error) {
    return apiError(error, "Unable to load deal activity.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await request.json();
    const settlementAction = body?.action === "venue_payment_received" ? body.action : null;
    if (settlementAction === "venue_payment_received") {
      const revenueEventId = typeof body?.revenueEventId === "string" ? body.revenueEventId.trim() : "";
      const externalReference = typeof body?.externalReference === "string" ? body.externalReference.trim() : "";
      if (!revenueEventId || !externalReference) {
        return NextResponse.json(
          { ok: false, error: "Revenue event and external payment reference are required." },
          { status: 400 },
        );
      }
      const revenueEvent = await settleDealRevenueEvent(
        client,
        revenueEventId,
        "venue_payment_received",
        externalReference,
      );
      console.info("DEAL_REVENUE_SETTLEMENT_RECORDED", {
        adminUserId: user.id,
        revenueEventId,
        action: settlementAction,
      });
      return NextResponse.json({ ok: true, revenueEvent });
    }

    const redemptionId = typeof body?.redemptionId === "string" ? body.redemptionId.trim() : "";
    if (!redemptionId) {
      return NextResponse.json({ ok: false, error: "Missing redemption." }, { status: 400 });
    }

    const result = await voidDealRedemption(client, redemptionId);
    if (!result) {
      return NextResponse.json({ ok: false, error: "Redemption is unavailable." }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update deal activity.");
  }
}
