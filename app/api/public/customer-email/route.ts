import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject, readBoundedRequestBytes } from "@/src/lib/bounded-json-body";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

export async function POST(request: Request) {
  try {
    let token: unknown, unsubscribe: boolean;
    const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (type === "application/x-www-form-urlencoded") {
      // RFC 8058 mailbox-provider POST: capability token, no cookies or account required.
      const bytes = await readBoundedRequestBytes(request, 256, "Invalid unsubscribe request.");
      const fields = new URLSearchParams(new TextDecoder().decode(bytes));
      if (fields.get("List-Unsubscribe") !== "One-Click" || [...fields].length !== 1) {
        throw new PublicApiError("INVALID_REQUEST", "Invalid unsubscribe request.", 400);
      }
      token = new URL(request.url).searchParams.get("token");
      unsubscribe = true;
    } else {
      requireSameOriginJsonMutation(request);
      const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid preference link.", tooLargeMessage: "Invalid preference link." });
      if (body.action !== "read" && body.action !== "unsubscribe") throw new PublicApiError("INVALID_REQUEST", "Invalid preference action.", 400);
      token = body.token;
      unsubscribe = body.action === "unsubscribe";
    }
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new PublicApiError("INVALID_REQUEST", "This email preference link is invalid.", 400);
    const { data, error } = await createAdminSupabaseClient().rpc("manage_customer_email_preference", { p_token: token, p_unsubscribe: unsubscribe });
    if (error?.code === "P0002") throw new PublicApiError("NOT_FOUND", "This email preference link is unavailable. Use the link in your latest email.", 404);
    if (error) throw error;
    if (typeof data?.active !== "boolean") throw new Error("Preference update was not confirmed.");
    return NextResponse.json({ ok: true, active: data.active }, { headers });
  } catch (error) {
    const response = apiError(error, "Unable to update email preferences. Please retry.");
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
