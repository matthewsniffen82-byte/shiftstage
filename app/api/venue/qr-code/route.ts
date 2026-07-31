import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { deleteVenueQrCode, uploadVenueQrCode } from "@/src/lib/dancr/venue";
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
      return NextResponse.json({ ok: false, error: "Choose a QR image to upload." }, { status: 400 });
    }

    const profile = await uploadVenueQrCode(
      createAdminSupabaseClient(),
      user.id,
      file,
      typeof formData.get("label") === "string" ? String(formData.get("label")) : null,
    );
    return NextResponse.json({
      ok: true,
      profile,
      message: "External marketing QR uploaded. Tracked Club Deals use MyDancr-generated QR codes.",
    });
  } catch (error) {
    return apiError(error, "Unable to upload venue QR code.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueRole(client, user.id);
    const profile = await deleteVenueQrCode(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, profile, message: "External marketing QR removed." });
  } catch (error) {
    return apiError(error, "Unable to remove venue QR code.", 400);
  }
}

async function requireVenueRole(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.accountState !== "active" || account.role !== "venue") {
    throw new Error("Active venue account required.");
  }
}
