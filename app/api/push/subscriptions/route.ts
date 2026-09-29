import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { webPushConfig } from "@/src/lib/dancr/web-push-config";
import { webPushEndpoint, webPushEndpointHash, webPushSubscription } from "@/src/lib/dancr/web-push-subscriptions";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { active: true });
    const config = webPushConfig();
    const { data, error } = await createAdminSupabaseClient().from("web_push_subscriptions")
      .select("endpoint_hash").eq("user_id", user.id).eq("vapid_public_key", config?.publicKey || "").limit(12);
    if (error) throw error;
    return NextResponse.json({ ok: true, userId: user.id, subscriptionIds: (data || []).map(row => row.endpoint_hash), session }, { headers });
  } catch (error) { return failure(error); }
}

async function mutate(request: Request, remove: boolean) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new PublicApiError("FORBIDDEN", "Open MyDancr to manage notifications.", 403);
    }
    const { user, session } = await createRequestSupabaseContext(request, { active: true });
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "web_push_enrollment", request, subject: user.id, windowSeconds: 60, ipLimit: 120, subjectLimit: 30 });
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid notification subscription.", tooLargeMessage: "Notification subscription is too large." });
    if (remove) {
      const endpoint = webPushEndpoint(body.endpoint);
      const { error } = await admin.from("web_push_subscriptions").delete().eq("endpoint_hash", webPushEndpointHash(endpoint)).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true, userId: user.id, session }, { headers });
    }
    const config = webPushConfig();
    if (!config) throw new PublicApiError("UNAVAILABLE", "Phone alerts are temporarily unavailable.", 503);
    if (body.publicKey !== config.publicKey) throw new PublicApiError("INVALID_REQUEST", "Notification setup changed. Reload and enable alerts again.", 409);
    const subscription = webPushSubscription(body.subscription);
    const id = webPushEndpointHash(subscription.endpoint);
    const { data, error } = await admin.rpc("save_web_push_subscription", {
      p_user_id: user.id, p_endpoint_hash: id, p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh, p_auth: subscription.keys.auth, p_vapid_public_key: config.publicKey,
    });
    if (error) throw error;
    if (data !== true) throw new PublicApiError("INVALID_REQUEST", "This device could not be registered. Remove an old device subscription or try enabling alerts again.", 409);
    return NextResponse.json({ ok: true, userId: user.id, subscriptionId: id, session }, { headers });
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
function failure(error: unknown) {
  if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) } });
  return apiError(error, "Unable to update phone alerts.");
}
