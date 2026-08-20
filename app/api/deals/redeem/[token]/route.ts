import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { redeemDealToken } from "@/src/lib/dancr/deal-redemption-actions";
import { getRedemptionForScanner } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const redemption = await getRedemptionForScanner(createAdminSupabaseClient(), token);
    if (!redemption) return NextResponse.json({ ok: false, error: "Club Deal not found." }, { status: 404 });

    return NextResponse.json({ ok: true, redemption });
  } catch (error) {
    return apiError(error, "Unable to load Club Deal redemption.");
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return NextResponse.json(
        { ok: false, error: "Active venue account required." },
        { status: 403 },
      );
    }

    const result = await redeemDealToken(client, token, request);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    console.info("QR_REDEMPTION_VENUE_CONFIRMED", {
      redemptionId: result.redemption?.id,
      venueUserId: user.id,
      sourceType: result.redemption?.sourceType,
    });
    return NextResponse.json({
      ok: true,
      redemption: result.redemption,
      confirmation: result.confirmation,
    });
  } catch (error) {
    return apiError(error, "Unable to redeem Club Deal.");
  }
}
