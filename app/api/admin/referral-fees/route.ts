import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
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
const MAX_REFERRAL_FEE_BODY_BYTES = 8_192;

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
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_REFERRAL_FEE_BODY_BYTES,
      invalidMessage: "Invalid referral fee request.",
      tooLargeMessage: "Referral fee request is too large.",
    });
    const admin = createAdminSupabaseClient();

    if (body.action === "set_fee" || body.action === "approve_request") {
      const result = await setAdminVenueReferralFee(admin, user.id, {
        venueId: stringValue(body.venueId),
        feeCents: Number(body.feeCents),
        effectiveFrom: stringValue(body.effectiveFrom),
        agreementReference: stringValue(body.agreementReference),
        decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
        requestId: body.action === "approve_request" ? stringValue(body.requestId) : null,
      });
      return NextResponse.json({ ok: true, referralFees: result.state, session: session || null });
    }

    if (body.action === "reject_request") {
      const result = await rejectAdminVenueReferralFeeRequest(
        admin,
        user.id,
        stringValue(body.requestId),
        stringValue(body.decisionNote),
      );
      return NextResponse.json({ ok: true, referralFees: result.state, session: session || null });
    }

    return NextResponse.json({ ok: false, error: "Unsupported referral fee action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to update the referral fee agreement.", 400);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
