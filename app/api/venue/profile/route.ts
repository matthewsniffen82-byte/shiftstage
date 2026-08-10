import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getVenueForAccount, updateVenueForAccount } from "@/src/lib/dancr/venue";
import { getLatestVenueOwnershipClaim } from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueRole(client, user.id);
    const profile = await getVenueForAccount(createAdminSupabaseClient(), user.id);
    if (!profile) {
      const claim = await getLatestVenueOwnershipClaim(createAdminSupabaseClient(), user.id);
      if (claim) return NextResponse.json({ ok: true, profile: null, claim });
      return NextResponse.json({ ok: false, error: "Venue profile not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return apiError(error, "Unable to load venue profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueRole(client, user.id);
    const body = await request.json();
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_profile");
    const profile = await updateVenueForAccount(admin, user.id, {
      name: optionalString(body.name),
      city: optionalString(body.city),
      state: optionalNullableString(body.state),
      address: optionalNullableString(body.address),
      phone: optionalNullableString(body.phone),
      website: optionalNullableString(body.website),
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

async function requireVenueRole(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.accountState !== "active") throw new Error("Active venue account required.");
  if (account.role !== "venue") throw new Error("Venue account required.");
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalNullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : undefined;
}
