import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { completeEmailConfirmation, EMAIL_ACTION_HEADERS, readEmailActionToken, redeemEmailAction } from "@/src/lib/dancr/email-actions";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Open the link from your email.", tooLargeMessage: "Invalid email link." });
    const claim = readEmailActionToken(body.link), admin = createAdminSupabaseClient();
    if (body.action === "complete") {
      const { user } = await createRequestSupabaseContext(request);
      await completeEmailConfirmation(admin, user.id, claim);
      return NextResponse.json({ ok: true }, { headers: EMAIL_ACTION_HEADERS });
    }
    return NextResponse.json({ ok: true, ...await redeemEmailAction(admin, claim) }, { headers: EMAIL_ACTION_HEADERS });
  } catch (error) {
    const response = apiError(error, "We couldn’t finish this action. Open the same email link and try again.");
    for (const [key, value] of Object.entries(EMAIL_ACTION_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
