import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { accountTermsAccess } from "@/src/lib/dancr/account-terms";
import { validateUserTermsAcceptance } from "@/src/lib/dancr/user-terms";
import { ACCESS_TERMS_VERSION } from "@/src/lib/dancr/access-terms";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    return NextResponse.json({ ok: true, terms: await accountTermsAccess(createAdminSupabaseClient(), user.id, new URL(request.url).searchParams.get("vip") === "true"), session }, { headers });
  } catch (error) { return apiError(error, "Unable to check the updated terms."); }
}
export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Accept the current terms.", tooLargeMessage: "Invalid acceptance." });
    validateUserTermsAcceptance(body);
    const vip = new URL(request.url).searchParams.get("vip") === "true";
    if (vip && (body.accessTermsAccepted !== true || body.accessTermsVersion !== ACCESS_TERMS_VERSION)) throw new PublicApiError("INVALID_REQUEST", "Accept the current VIP & Table Access Terms.", 400);
    const { data, error } = await createAdminSupabaseClient().rpc("accept_current_account_terms", { p_user: user.id, p_user_version: body.userTermsVersion, p_access_version: vip ? ACCESS_TERMS_VERSION : null, p_accepted: true });
    if (error || data?.accepted !== true) throw new PublicApiError("UNAVAILABLE", "Your acceptance could not be saved. Please try again.", 503);
    return NextResponse.json({ ok: true, terms: data, session }, { headers });
  } catch (error) { return apiError(error, "Unable to save your acceptance."); }
}
