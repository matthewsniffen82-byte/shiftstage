import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  getVenueReferralFeeStateForAccount,
  requestVenueReferralFeeChange,
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
    const { user } = await createRequestSupabaseContext(request);
    const body = await request.json().catch(() => ({}));
    const requestRecord = await requestVenueReferralFeeChange(
      createAdminSupabaseClient(),
      user.id,
      {
        requestedFeeCents: body.requestedFeeCents,
        reason: body.reason,
      },
    );
    console.info("VENUE_REFERRAL_FEE_CHANGE_REQUESTED", {
      venueId: requestRecord.venueId,
      requestId: requestRecord.id,
      requestedFeeCents: requestRecord.requestedFeeCents,
      requestedByUserId: user.id,
    });
    const referralFee = await getVenueReferralFeeStateForAccount(
      createAdminSupabaseClient(),
      user.id,
    );
    return NextResponse.json({
      ok: true,
      referralFee,
      message: "Referral fee change request sent to MyDancr for review.",
    });
  } catch (error) {
    return apiError(error, "Unable to request a referral fee change.", 400);
  }
}
