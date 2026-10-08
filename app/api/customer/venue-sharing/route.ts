import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requirePublicVenue } from "@/src/lib/dancr/resource-authorization";
import { normalizeVenueShare, VENUE_SHARING_CONSENT_VERSION } from "@/src/lib/dancr/venue-customers";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
function venueId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new PublicApiError("INVALID_REQUEST", "Invalid club.", 400);
  return value;
}
export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const id = venueId(new URL(request.url).searchParams.get("venueId"));
    const { data, error } = await createAdminSupabaseClient().from("venue_customer_shares")
      .select("name,email,city,consented_at").eq("customer_id", user.id).eq("venue_id", id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, share: data, email: user.email || "", session }, { headers });
  } catch (error) { return apiError(error, "Unable to load sharing preferences."); }
}
export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "customer" });
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid sharing preference.", tooLargeMessage: "Sharing preference is too large." });
    const id = venueId(body.venueId);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "customer_venue_sharing", request, subject: user.id,
      windowSeconds: 60, ipLimit: 120, subjectLimit: 30 });
    if (body.sharing === false) {
      const { error } = await admin.from("venue_customer_shares").delete().eq("customer_id", user.id).eq("venue_id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true, share: null, session }, { headers });
    }
    const contact = normalizeVenueShare(body);
    if (body.sharing !== true || !contact || !user.email || !user.email_confirmed_at || body.email !== user.email)
      throw new PublicApiError("INVALID_REQUEST", "Enter your name, verify your account email, and agree to share your details.", 400);
    await requirePublicVenue(admin, id);
    const { data: follow, error: followError } = await admin.from("venue_follows").select("venue_id")
      .eq("customer_id", user.id).eq("venue_id", id).maybeSingle();
    if (followError) throw followError;
    if (!follow) throw new PublicApiError("INVALID_REQUEST", "Follow this club before sharing your details.", 400);
    const share = { ...contact, email: user.email, consented_at: new Date().toISOString() };
    const { error } = await admin.from("venue_customer_shares").upsert({
      customer_id: user.id, venue_id: id, ...share, consent_version: VENUE_SHARING_CONSENT_VERSION,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, share, session }, { headers });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json(
      { ok: false, error: error.message }, { status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) } });
    return apiError(error, "Unable to update sharing preferences.");
  }
}
