import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminReferralFeeState,
  rejectAdminVenueReferralFeeRequest,
  setAdminVenueReferralFee,
} from "@/src/lib/dancr/referral-fees";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    return NextResponse.json({
      ok: true,
      referralFees: await getAdminReferralFeeState(createAdminSupabaseClient()),
      session: session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to load referral fee agreements.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();

    if (body.action === "set_fee" || body.action === "approve_request") {
      const result = await setAdminVenueReferralFee(admin, user.id, {
        venueId: body.venueId,
        feeCents: body.feeCents,
        effectiveFrom: body.effectiveFrom,
        agreementReference: body.agreementReference,
        decisionNote: body.decisionNote,
        requestId: body.action === "approve_request" ? body.requestId : null,
      });
      return NextResponse.json({ ok: true, referralFees: result.state, session: session || null });
    }

    if (body.action === "reject_request") {
      const result = await rejectAdminVenueReferralFeeRequest(
        admin,
        user.id,
        body.requestId,
        body.decisionNote,
      );
      return NextResponse.json({ ok: true, referralFees: result.state, session: session || null });
    }

    return NextResponse.json({ ok: false, error: "Unsupported referral fee action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to update the referral fee agreement.", 400);
  }
}
