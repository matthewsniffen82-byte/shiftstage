import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getRedemptionForScanner } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { admissionError, ADMISSION_TOKEN_PATTERN, PASS_HEADERS } from "@/src/lib/dancr/admission-passes";
import { enforcePublicRequestRateLimit } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ token: string }>;
};

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    if (!ADMISSION_TOKEN_PATTERN.test(token)) return NextResponse.json({ ok: false, error: "Pass not found." }, { status: 404, headers: PASS_HEADERS });
    await enforcePublicRequestRateLimit(createAdminSupabaseClient(), { namespace: "admission_status", request, subject: token, windowSeconds: 60, ipLimit: 120, subjectLimit: 120 });
    const redemption = await getRedemptionForScanner(createAdminSupabaseClient(), token);
    if (!redemption) return NextResponse.json({ ok: false, error: "Club Deal not found." }, { status: 404, headers: PASS_HEADERS });

    return NextResponse.json({ ok: true, redemption }, { headers: PASS_HEADERS });
  } catch (error) {
    return admissionError(error) || apiError(error, "Unable to load Club Deal redemption.");
  }
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    if (!ADMISSION_TOKEN_PATTERN.test(token)) return NextResponse.json({ ok: false, error: "Pass not found." }, { status: 404, headers: PASS_HEADERS });
    const { client, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const body = await readBoundedJsonObject(request, { maxBytes: 256, invalidMessage: "Confirm the arrival method.", tooLargeMessage: "Invalid confirmation." });
    await enforcePublicRequestRateLimit(createAdminSupabaseClient(), { namespace: "admission_redeem", request, subject: token, windowSeconds: 60, ipLimit: 120, subjectLimit: 12 });
    const { data, error } = await (client as any).rpc("confirm_admission_pass", { p_token: token, p_arrival_verified: body.arrivalVerified === true });
    if (error) throw error;
    if (data?.status !== "redeemed") throw new Error("Admission confirmation missing.");
    const redemption = await getRedemptionForScanner(createAdminSupabaseClient(), token);
    return NextResponse.json({ ok: true, redemption, alreadyRedeemed: data.alreadyRedeemed === true, session: session || null }, { headers: PASS_HEADERS });
  } catch (error) {
    return admissionError(error) || apiError(error, "Unable to confirm this admission.");
  }
}
