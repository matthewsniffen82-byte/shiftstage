import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { resolveVipInvitation, VIP_HEADERS, vipError, vipTokenDigest } from "@/src/lib/dancr/vip";
import { ACCESS_TERMS_VERSION } from "@/src/lib/dancr/access-terms";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { validateUserTermsAcceptance } from "@/src/lib/dancr/user-terms";
import { USER_TERMS_VERSION } from "@/src/lib/dancr/user-terms-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const readBody = (request: Request) => readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid VIP invitation.", tooLargeMessage: "Invitation request is too large." });
// Tokens stay out of API query strings and referral headers.
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    return NextResponse.json({ ok: true, invitation: await resolveVipInvitation(createAdminSupabaseClient(), body.token) }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBody(request);
    if (body.termsAccepted !== true || body.termsVersion !== ACCESS_TERMS_VERSION) {
      throw new PublicApiError("INVALID_REQUEST", "Please refresh and accept the VIP & Table Access Terms to activate VIP access.", 400);
    }
    validateUserTermsAcceptance(body);
    const { data, error } = await createAdminSupabaseClient().rpc("vip_accept_invitation_with_user_terms", {
      p_actor: user.id, p_digest: vipTokenDigest(body.token), p_name: typeof body.name === "string" ? body.name : "",
      p_version: ACCESS_TERMS_VERSION, p_accepted: true,
      p_user_terms_version: USER_TERMS_VERSION, p_user_terms_accepted: true,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, venueId: data, session }, { headers: VIP_HEADERS });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  const response = apiError(vipError(error), "Unable to open this VIP invitation.");
  for (const [key, value] of Object.entries(VIP_HEADERS)) response.headers.set(key, value);
  return response;
}
