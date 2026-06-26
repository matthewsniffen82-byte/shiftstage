import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminVenue, getAdminVenues, requireAdmin, updateAdminVenue } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const city = new URL(request.url).searchParams.get("city");
    const venues = await getAdminVenues(createAdminSupabaseClient(), city);

    return NextResponse.json({ ok: true, venues });
  } catch (error) {
    return apiError(error, "Unable to load admin venues.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const venue = await createAdminVenue(createAdminSupabaseClient(), user.id, await request.json());
    return NextResponse.json({ ok: true, venue });
  } catch (error) {
    return apiError(error, "Unable to create venue.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await request.json();
    const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : "";

    if (!venueId) {
      return NextResponse.json({ ok: false, error: "Missing venueId." }, { status: 400 });
    }

    const venue = await updateAdminVenue(createAdminSupabaseClient(), user.id, venueId, body);
    return NextResponse.json({ ok: true, venue });
  } catch (error) {
    return apiError(error, "Unable to update venue.");
  }
}
