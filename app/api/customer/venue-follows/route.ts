import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { unfollowVenue } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const venueId = body?.venueId;
    const following = body?.following !== false;
    const notificationsEnabled = body?.notificationsEnabled !== false;

    if (typeof venueId !== "string" || !UUID_PATTERN.test(venueId)) {
      return NextResponse.json({ ok: false, error: "Invalid venueId." }, { status: 400 });
    }

    if (!following) {
      await unfollowVenue(client, user.id, venueId);
      return NextResponse.json({ ok: true, following: false, notificationsEnabled: false });
    }

    const { error } = await (client as any).from("venue_follows").upsert({
      customer_id: user.id,
      venue_id: venueId,
      notifications_enabled: notificationsEnabled,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true, following: true, notificationsEnabled });
  } catch (error) {
    return apiError(error, "Unable to update venue follow.");
  }
}
