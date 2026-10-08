import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { resolveVipInvitation, VIP_HEADERS, vipError, vipTokenDigest } from "@/src/lib/dancr/vip";

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
    const { data, error } = await createAdminSupabaseClient().rpc("vip_accept_invitation", {
      p_actor: user.id, p_digest: vipTokenDigest(body.token), p_name: typeof body.name === "string" ? body.name : "",
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
