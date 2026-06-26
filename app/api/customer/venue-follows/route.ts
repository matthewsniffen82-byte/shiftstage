import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { unfollowVenue } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const venueId = body?.venueId;
    const following = body?.following !== false;
    const notificationsEnabled = body?.notificationsEnabled !== false;

    if (!venueId) {
      return NextResponse.json({ ok: false, error: "Missing venueId." }, { status: 400 });
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
