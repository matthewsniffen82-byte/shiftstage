import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: Request, venueId: unknown) {
  const { client, user } = await createRequestSupabaseContext(request);
  const account = await getAccountByUserId(client, user.id);
  if (!account || account.accountState !== "active") throw new PublicApiError("FORBIDDEN", "An active account is required.", 403);
  if (typeof venueId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a club.", 400);
  }
  const admin = createAdminSupabaseClient();
  if (account.role !== "admin") {
    const access = await requireVenueAccess(admin, user.id, "manage_profile");
    if (access.role !== "owner" || access.venueId !== venueId) throw new PublicApiError("FORBIDDEN", "Only the club owner or MyDancr can remove this club.", 403);
  }
  return { admin, user, venueId };
}

export async function GET(request: Request) {
  try {
    const { admin, venueId } = await context(request, new URL(request.url).searchParams.get("venueId"));
    const { data, error } = await admin.from("venue_participation_ends").select("ended_at").eq("venue_id", venueId).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, venueId, endedAt: data?.ended_at || null }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to check club participation."); }
}

export async function DELETE(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid club removal request.", tooLargeMessage: "Club removal request is too large." });
    const { admin, user, venueId } = await context(request, body.venueId);
    if (body.confirmed !== true) throw new PublicApiError("INVALID_REQUEST", "Confirm removal of this club and its dancer associations.", 400);
    const { data, error } = await admin.rpc("end_venue_participation", { p_actor_user_id: user.id, p_venue_id: venueId });
    if (error) {
      if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "Your account cannot remove this club.", 403);
      throw error;
    }
    if (data?.venueId !== venueId || typeof data.endedAt !== "string" || !Number.isFinite(Date.parse(data.endedAt)) || data.dancerAccountsPreserved !== true) {
      throw new PublicApiError("UNAVAILABLE", "Club removal could not be confirmed. Refresh before trying again.", 503);
    }
    return NextResponse.json({ ok: true, ...data }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Club removal could not be confirmed. Refresh and try again."); }
}
