import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { getVenueForAccount, updateVenueForAccount } from "@/src/lib/dancr/venue";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_VENUE_PROFILE_BODY_BYTES = 16_384;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const [profile, venueAccess] = await Promise.all([
      getVenueForAccount(admin, user.id),
      requireVenueAccess(admin, user.id, "view_dashboard"),
    ]);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Venue profile not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, profile, venueAccess });
  } catch (error) {
    return apiError(error, "Unable to load venue profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_VENUE_PROFILE_BODY_BYTES,
      invalidMessage: "Invalid venue profile request.",
      tooLargeMessage: "Venue profile request is too large.",
    });
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_profile");
    const profile = await updateVenueForAccount(admin, user.id, {
      name: optionalString(body.name),
      city: optionalString(body.city),
      state: optionalNullableString(body.state),
      address: optionalNullableString(body.address),
      phone: optionalNullableString(body.phone),
      website: optionalNullableString(body.website),
      opensAt: optionalNullableString(body.opensAt),
      closesAt: optionalNullableString(body.closesAt),
      qrCodeLabel: optionalNullableString(body.qrCodeLabel),
    });
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: user.id,
      actorRole: access.role,
      action: "profile.details_updated",
      targetType: "venue",
      targetId: profile.id,
      summary: "Public venue details were updated.",
    });
    return NextResponse.json({ ok: true, profile, message: "Venue profile saved." });
  } catch (error) {
    return apiError(error, "Unable to save venue profile.", 400);
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalNullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : undefined;
}
