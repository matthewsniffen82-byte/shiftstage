import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  deleteVenueCoverImage,
  uploadVenueCoverImage,
} from "@/src/lib/dancr/venue";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueRole(client, user.id);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, error: "Choose a venue cover image to upload." },
        { status: 400 },
      );
    }

    const profile = await uploadVenueCoverImage(
      createAdminSupabaseClient(),
      user.id,
      file,
    );
    return NextResponse.json({
      ok: true,
      profile,
      message: "Venue cover image approved and published.",
    });
  } catch (error) {
    return apiError(error, "Unable to publish venue cover image.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueRole(client, user.id);
    const profile = await deleteVenueCoverImage(createAdminSupabaseClient(), user.id);
    return NextResponse.json({
      ok: true,
      profile,
      message: "Venue cover image removed from public pages.",
    });
  } catch (error) {
    return apiError(error, "Unable to remove venue cover image.", 400);
  }
}

async function requireVenueRole(
  client: Parameters<typeof getAccountByUserId>[0],
  userId: string,
) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.accountState !== "active" || account.role !== "venue") {
    throw new Error("Active venue account required.");
  }
}
