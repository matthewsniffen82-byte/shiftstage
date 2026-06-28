import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getRedemptionForScanner, redeemDealToken } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const redemption = await getRedemptionForScanner(createAdminSupabaseClient(), token);
    if (!redemption) return NextResponse.json({ ok: false, error: "QR code not found." }, { status: 404 });

    return NextResponse.json({ ok: true, redemption });
  } catch (error) {
    return apiError(error, "Unable to load QR redemption.");
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const result = await redeemDealToken(createAdminSupabaseClient(), token, request);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, redemption: result.redemption });
  } catch (error) {
    return apiError(error, "Unable to redeem QR code.");
  }
}
