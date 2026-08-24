import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin, resetManagedVenuePageReview } from "@/src/lib/dancr/admin";
import {
  deleteVenueCoverImageByAdmin,
  deleteVenueLogoImageByAdmin,
  uploadVenueCoverImageByAdmin,
  uploadVenueLogoImageByAdmin,
} from "@/src/lib/dancr/venue";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VenueImageKind = "logo" | "cover";

function imageKind(value: FormDataEntryValue | string | null): VenueImageKind | null {
  return value === "logo" || value === "cover" ? value : null;
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const form = await request.formData();
    const venueId = String(form.get("venueId") || "").trim();
    const kind = imageKind(form.get("kind"));
    const file = form.get("file");
    if (!venueId || !kind || !(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ ok: false, error: "Venue, image type, and image file are required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const venue = kind === "logo"
      ? await uploadVenueLogoImageByAdmin(admin, user.id, venueId, file)
      : await uploadVenueCoverImageByAdmin(admin, user.id, venueId, file);
    await resetManagedVenuePageReview(admin, user.id, venueId, `${kind} uploaded`);
    return NextResponse.json({ ok: true, venue });
  } catch (error) {
    return apiError(error, "Unable to upload venue image.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json();
    const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : "";
    const kind = imageKind(typeof body?.kind === "string" ? body.kind : null);
    if (!venueId || !kind) {
      return NextResponse.json({ ok: false, error: "Venue and image type are required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const venue = kind === "logo"
      ? await deleteVenueLogoImageByAdmin(admin, venueId)
      : await deleteVenueCoverImageByAdmin(admin, venueId);
    await resetManagedVenuePageReview(admin, user.id, venueId, `${kind} removed`);
    return NextResponse.json({ ok: true, venue });
  } catch (error) {
    return apiError(error, "Unable to remove venue image.");
  }
}
