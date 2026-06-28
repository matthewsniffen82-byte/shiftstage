import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { getAdminDealActivity, voidDealRedemption } from "@/src/lib/dancr/deals";
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
    const redemptionId = typeof body?.redemptionId === "string" ? body.redemptionId.trim() : "";
    if (!redemptionId) {
      return NextResponse.json({ ok: false, error: "Missing redemption." }, { status: 400 });
    }

    const result = await voidDealRedemption(createAdminSupabaseClient(), redemptionId, user.id);
    if (!result) {
      return NextResponse.json({ ok: false, error: "Redemption is already voided or unavailable." }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update deal activity.");
  }
}
