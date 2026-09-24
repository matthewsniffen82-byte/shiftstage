import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { venueNotificationMetadataPatch, venueNotificationSettings } from "@/src/lib/dancr/venue-notification-preferences";
import { customerNotificationDelivery } from "@/src/lib/dancr/customer-notification-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    return NextResponse.json({ ok: true, userId: user.id, settings: venueNotificationSettings(user.user_metadata),
      delivery: customerNotificationDelivery(user.id, user.email), session }, { headers: privateHeaders });
  } catch (error) { return apiError(error, "Unable to load notification preferences."); }
}

export async function PATCH(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const body = await readBoundedJsonObject(request, { maxBytes: 2_048, invalidMessage: "Invalid notification settings.", tooLargeMessage: "Notification settings are too large." });
    let metadata: Record<string, boolean>;
    try { metadata = venueNotificationMetadataPatch(body.settings); }
    catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
    const delivery = customerNotificationDelivery(user.id, user.email);
    if ((metadata.mydancr_venue_notify_emailEnabled === true && !delivery.emailAvailable)
      || (metadata.mydancr_venue_notify_pushEnabled === true && !delivery.pushAvailable)) {
      return NextResponse.json({ ok: false, error: "That delivery option is not available right now." }, { status: 503 });
    }
    const { data, error } = await createAdminSupabaseClient().auth.admin.updateUserById(user.id, { user_metadata: metadata });
    if (error || !data.user) throw error || new Error("Notification preferences were not saved.");
    return NextResponse.json({ ok: true, userId: user.id, settings: venueNotificationSettings(data.user.user_metadata), session }, { headers: privateHeaders });
  } catch (error) { return apiError(error, "Unable to save notification preferences."); }
}
