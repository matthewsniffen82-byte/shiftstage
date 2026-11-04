import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { EMAIL_ACTION_HEADERS, getEmailActionDetails, readEmailActionToken } from "@/src/lib/dancr/email-actions";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kept separate from redemption so older deployments cannot treat a details
// request as an attempt to consume the link.
export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Open the link from your email.", tooLargeMessage: "Invalid email link." });
    const claim = readEmailActionToken(body.link);
    const details = await getEmailActionDetails(createAdminSupabaseClient(), claim);
    return NextResponse.json({ ok: true, ...details }, { headers: EMAIL_ACTION_HEADERS });
  } catch (error) {
    const response = apiError(error, "Unable to read this email link. Press Continue to try again.");
    for (const [key, value] of Object.entries(EMAIL_ACTION_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
