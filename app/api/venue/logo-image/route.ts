import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { deleteVenueLogoImage, uploadVenueLogoImage } from "@/src/lib/dancr/venue";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Choose a venue logo to upload." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_profile");
    const profile = await uploadVenueLogoImage(admin, user.id, file);
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: user.id,
      actorRole: access.role,
      action: "profile.logo_published",
      targetType: "venue",
      targetId: profile.id,
      summary: "The venue logo was uploaded.",
    });
    return NextResponse.json({ ok: true, profile, message: "Venue logo uploaded." });
  } catch (error) {
    return apiError(error, "Unable to upload venue logo.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_profile");
    const profile = await deleteVenueLogoImage(admin, user.id);
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: user.id,
      actorRole: access.role,
      action: "profile.logo_removed",
      targetType: "venue",
      targetId: profile.id,
      summary: "The venue logo was removed.",
    });
    return NextResponse.json({ ok: true, profile, message: "Venue logo removed." });
  } catch (error) {
    return apiError(error, "Unable to remove venue logo.", 400);
  }
}
