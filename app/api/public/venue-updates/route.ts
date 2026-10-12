import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request) {
  try {
    requireSameOriginJsonMutation(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid update preference.", tooLargeMessage: "Invalid update preference." });
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || !["read", "unsubscribe"].includes(String(body.action)))
      throw new PublicApiError("INVALID_REQUEST", "This update preference link is invalid.", 400);
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.from("venue_update_subscriptions").select("channel,withdrawn_at,venues(name)").eq("manage_token", body.token).maybeSingle();
    if (error) throw error;
    if (!data) throw new PublicApiError("NOT_FOUND", "This update preference link is unavailable.", 404);
    if (body.action === "unsubscribe" && !data.withdrawn_at) {
      const { error: updateError } = await admin.from("venue_update_subscriptions").update({ withdrawn_at: new Date().toISOString() }).eq("manage_token", body.token);
      if (updateError) throw updateError;
    }
    const venue = Array.isArray(data.venues) ? data.venues[0] : data.venues;
    return NextResponse.json({ ok: true, channel: data.channel, venueName: venue?.name || "this club", active: body.action !== "unsubscribe" && !data.withdrawn_at }, { headers });
  } catch (error) {
    const response = apiError(error, "Unable to update your preferences. Please retry.");
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
