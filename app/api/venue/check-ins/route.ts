import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    return NextResponse.json({ ok: false, code: "nfc_managed_presence", error: "Working status is managed by NFC. To remove a dancer’s club access, remove their affiliation from the venue roster." }, { status: 410, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to access the venue roster."); }
}
