import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { getAdminVenueOwnershipClaims } from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const claims = await getAdminVenueOwnershipClaims(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, claims });
  } catch (error) {
    return apiError(error, "Unable to load venue ownership claims.");
  }
}
export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    return NextResponse.json({
      ok: false,
      error: "Venue ownership claims are retired. Review the venue request queue instead.",
    }, { status: 410 });
  } catch (error) {
    return apiError(error, "Unable to retire venue ownership claims.");
  }
}
