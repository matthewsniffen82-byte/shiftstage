import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedFormData } from "@/src/lib/bounded-form-data";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { MAX_DANCR_RAW_UPLOAD_BYTES } from "@/src/lib/dancr/image-validation";
import { deleteVenueLogoImage, uploadVenueLogoImage } from "@/src/lib/dancr/venue";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_VENUE_IMAGE_UPLOAD_BODY_BYTES = MAX_DANCR_RAW_UPLOAD_BYTES + 64 * 1024;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const formData = await readBoundedFormData(request, {
      maxBytes: MAX_VENUE_IMAGE_UPLOAD_BODY_BYTES,
      invalidMessage: "Invalid venue logo upload request.",
      tooLargeMessage: "Venue logo upload request is too large.",
    });
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
