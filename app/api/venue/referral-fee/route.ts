import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  getVenueReferralFeeStateForAccount,
} from "@/src/lib/dancr/referral-fees";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const referralFee = await getVenueReferralFeeStateForAccount(
      createAdminSupabaseClient(),
      user.id,
    );
    return NextResponse.json({ ok: true, referralFee });
  } catch (error) {
    return apiError(error, "Unable to load the referral fee agreement.");
  }
}

export async function POST(request: Request) {
  try {
    await createRequestSupabaseContext(request);
    return NextResponse.json({
      ok: false,
      error: "Referral fees are recorded by MyDancr from the signed venue agreement and are read-only in the venue workspace.",
    }, { status: 403 });
  } catch (error) {
    return apiError(error, "Unable to verify the referral fee request.");
  }
}
