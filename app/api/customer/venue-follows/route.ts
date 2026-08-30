import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { unfollowVenue } from "@/src/lib/dancr/customer";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { requirePublicVenue } from "@/src/lib/dancr/resource-authorization";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CUSTOMER_ACTION_BODY_BYTES = 4_096;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, {
      namespace: "customer_venue_follow",
      request,
      subject: user.id,
      windowSeconds: 60,
      ipLimit: 180,
      subjectLimit: 90,
    });
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_CUSTOMER_ACTION_BODY_BYTES,
      invalidMessage: "Invalid venue follow request.",
      tooLargeMessage: "Venue follow request is too large.",
    });
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

    await requirePublicVenue(admin, venueId);
    const { error } = await (client as any).from("venue_follows").upsert({
      customer_id: user.id,
      venue_id: venueId,
      notifications_enabled: notificationsEnabled,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true, following: true, notificationsEnabled });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to update venue follow.");
  }
}
