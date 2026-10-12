import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { updateLinkToken } from "@/src/lib/dancr/customer-club-privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function context(request: Request) {
  const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
  return { user, session, admin: createAdminSupabaseClient(), args: {
    p_customer_id: user.id,
    p_email: user.email_confirmed_at ? user.email?.trim().toLowerCase() || null : null,
    p_phone: user.phone_confirmed_at && user.phone ? `+${user.phone.replace(/^\+/, "")}` : null,
  } };
}
function failure(error: unknown) {
  if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfterSeconds) } });
  const response = apiError(error, "Unable to update club privacy. Please try again.");
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
export async function GET(request: Request) {
  try {
    const { session, admin, args } = await context(request);
    const page = Number(new URL(request.url).searchParams.get("page") || 0);
    if (!Number.isInteger(page) || page < 0 || page > 5000) throw new PublicApiError("INVALID_REQUEST", "Invalid page.", 400);
    const { data, error } = await admin.rpc("get_customer_club_privacy", { ...args, p_offset: page * 20 });
    if (error) throw error;
    return NextResponse.json({ ok: true, clubs: (data || []).slice(0, 20), hasMore: (data || []).length > 20,
      verifiedEmail: args.p_email, session }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOriginJsonMutation(request);
    const { user, session, admin, args } = await context(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid privacy request.", tooLargeMessage: "Privacy request is too large." });
    await enforcePublicRequestRateLimit(admin, { namespace: "customer_club_privacy", request, subject: user.id, windowSeconds: 60, ipLimit: 120, subjectLimit: 30 });
    if (body.action === "link") {
      const token = updateLinkToken(body.link, new URL(request.url).origin);
      if (!token) throw new PublicApiError("INVALID_REQUEST", "Paste the private update link from your visit or ride confirmation.", 400);
      const { data, error } = await admin.from("venue_update_subscriptions").select("id").eq("manage_token", token).maybeSingle();
      if (error) throw error;
      if (!data) throw new PublicApiError("NOT_FOUND", "That update link is unavailable.", 404);
      const result = await admin.from("customer_update_links").upsert({ customer_id: user.id, subscription_id: data.id }, { onConflict: "customer_id,subscription_id", ignoreDuplicates: true });
      if (result.error) throw result.error;
    } else if (body.action === "stop_updates" && typeof body.subscriptionId === "string" && uuid.test(body.subscriptionId)) {
      const { data, error } = await admin.rpc("stop_customer_club_update", { ...args, p_subscription_id: body.subscriptionId });
      if (error) throw error;
      if (data !== true) throw new PublicApiError("NOT_FOUND", "This update preference is unavailable.", 404);
    } else if (body.action === "stop_sharing" && typeof body.venueId === "string" && uuid.test(body.venueId)) {
      const { error } = await admin.from("venue_customer_shares").delete().eq("customer_id", user.id).eq("venue_id", body.venueId);
      if (error) throw error;
    } else throw new PublicApiError("INVALID_REQUEST", "Choose a valid privacy action.", 400);
    return NextResponse.json({ ok: true, session }, { headers });
  } catch (error) { return failure(error); }
}
