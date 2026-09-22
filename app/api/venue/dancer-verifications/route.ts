import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import {
  getVenueDancerVerificationState,
  revokeDancerVenueAffiliation,
  VenueAffiliationUserError,
} from "@/src/lib/dancr/venue-affiliations";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AFFILIATION_BODY_BYTES = 2_048;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    await requireVenueAccess(createAdminSupabaseClient(), user.id, "view_roster");
    const token = new URL(request.url).searchParams.get("token");
    const state = await getVenueDancerVerificationState(createAdminSupabaseClient(), user.id, token);
    return noStoreJson({ ok: true, ...state });
  } catch (error) {
    return affiliationApiError(error, "Unable to load dancer verification.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    return noStoreJson({
      ok: false,
      code: "dressing_room_nfc_required",
      error: "Manager QR approval is retired. A dancer authorizes venue access by tapping the official MyDancr dressing-room sticker.",
    }, 410);
  } catch (error) {
    return affiliationApiError(error, "Unable to approve dancer verification.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_roster");
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_AFFILIATION_BODY_BYTES,
      invalidMessage: "Invalid dancer affiliation request.",
      tooLargeMessage: "Dancer affiliation request is too large.",
    });
    const affiliation = await revokeDancerVenueAffiliation(admin, {
      actorUserId: user.id,
      affiliationId: typeof body.affiliationId === "string" ? body.affiliationId : "",
      reason: typeof body.reason === "string" ? body.reason : "Venue manager removed affiliation.",
    });
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: user.id,
      actorRole: access.role,
      action: "roster.access_removed",
      targetType: "venue_dancer_affiliation",
      targetId: String(affiliation.id),
      summary: `${String(affiliation.stageName)} was removed from the verified roster.`,
    });
    return noStoreJson({
      ok: true,
      affiliation,
      message: `${String(affiliation.stageName)} is no longer verified at this venue.`,
    });
  } catch (error) {
    return affiliationApiError(error, "Unable to remove dancer verification.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_roster");
    const body = await readBoundedJsonObject(request, { maxBytes: MAX_AFFILIATION_BODY_BYTES, invalidMessage: "Invalid dancer access request.", tooLargeMessage: "Dancer access request is too large." });
    if (body.action !== "allow_new_tap" || typeof body.affiliationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.affiliationId)) {
      throw new PublicApiError("INVALID_REQUEST", "Choose a removed dancer.", 400);
    }
    const { data: current, error: readError } = await admin.from("venue_dancer_affiliations").select("venue_id").eq("id", body.affiliationId).maybeSingle();
    if (readError) throw readError;
    if (current?.venue_id !== access.venueId) throw new PublicApiError("FORBIDDEN", "This dancer is not associated with your club.", 403);
    const { data, error } = await admin.rpc("allow_dancer_venue_retap", { p_actor_user_id: user.id, p_affiliation_id: body.affiliationId });
    if (error) throw new PublicApiError("FORBIDDEN", "Unable to allow a new tap. Check that your club is active and refresh.", 403);
    if (data?.id !== body.affiliationId || data.venueId !== access.venueId || data.requiresNewTap !== true) {
      throw new PublicApiError("UNAVAILABLE", "New tap permission could not be confirmed. Refresh before trying again.", 503);
    }
    await recordVenueActivity(admin, { venueId: access.venueId, actorUserId: user.id, actorRole: access.role,
      action: "roster.new_tap_allowed", targetType: "venue_dancer_affiliation", targetId: body.affiliationId,
      summary: "The club allowed a removed dancer to establish access with a new dressing-room tap." });
    return noStoreJson({ ok: true, ...data });
  } catch (error) { return affiliationApiError(error, "Unable to allow a new dancer tap."); }
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}

function affiliationApiError(error: unknown, fallback: string) {
  if (error instanceof VenueAffiliationUserError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  console.error("VENUE_DANCER_VERIFICATION_FAILED", safeErrorMetadata(error));
  return apiError(error, fallback);
}
