import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { deliverNotificationRows } from "@/src/lib/dancr/notification-delivery";
import { isValidShiftRange } from "@/src/lib/dancr/schedule";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const dancer = await getOwnDancerProfile(client as any, user.id);
    const { data, error } = await (client as any)
      .from("shifts")
      .select("id, venue_id, starts_at, ends_at, timezone, status, broadcast_sent_at, broadcast_recipients, location_status, checked_in_at, checked_out_at, checkin_distance_feet, working_status, commission_tracking_started_at, commission_tracking_stopped_at, ended_at, ended_reason, shift_summary, venues(name, slug, city, latitude, longitude)")
      .eq("dancer_id", dancer.id)
      .order("starts_at", { ascending: false })
      .limit(25);

    if (error) throw error;

    return NextResponse.json({ ok: true, shifts: data || [] });
  } catch (error) {
    return apiError(error, "Unable to load dancer shifts.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const dancer = await getOwnDancerProfile(client as any, user.id);

    if (dancer.status !== "approved") {
      return NextResponse.json({ ok: false, error: "Profile approval required before posting shifts." }, { status: 403 });
    }

    if (!body?.venueId || !body?.startsAt || !body?.endsAt) {
      return NextResponse.json({ ok: false, error: "Missing venueId, startsAt, or endsAt." }, { status: 400 });
    }

    if (!isValidShiftRange(body.startsAt, body.endsAt)) {
      return NextResponse.json({ ok: false, error: "Shift end must be after shift start." }, { status: 400 });
    }

    const venue = await getVenueForShift(client as any, body.venueId);
    const timezone = typeof body.timezone === "string" ? body.timezone : venue.timezone;

    const { data, error } = await (client as any)
      .from("shifts")
      .insert({
        dancer_id: dancer.id,
        venue_id: body.venueId,
        starts_at: body.startsAt,
        ends_at: body.endsAt,
        timezone,
        status: "posted",
      })
      .select("id")
      .single();

    if (error) throw error;

    const broadcastRecipients = await broadcastShiftPosted(dancer, data.id, body.venueId, body.startsAt);
    const { error: updateError } = await (client as any)
      .from("shifts")
      .update({
        broadcast_sent_at: new Date().toISOString(),
        broadcast_recipients: broadcastRecipients,
      })
      .eq("id", data.id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, shiftId: data.id, broadcastRecipients });
  } catch (error) {
    return apiError(error, "Unable to post dancer shift.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();

    if (!body?.shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    const dancer = await getOwnDancerProfile(client as any, user.id);
    const existingShift = await getOwnShift(client as any, dancer.id, body.shiftId);
    const update: Record<string, unknown> = {};
    if (typeof body.venueId === "string") {
      const venue = await getVenueForShift(client as any, body.venueId);
      update.venue_id = body.venueId;
      update.timezone = venue.timezone;
    }
    if (typeof body.startsAt === "string") update.starts_at = body.startsAt;
    if (typeof body.endsAt === "string") update.ends_at = body.endsAt;
    if (typeof body.timezone === "string") update.timezone = body.timezone;
    if (["posted", "cancelled", "draft"].includes(body.status)) update.status = body.status;
    if (["self_reported", "checked_in", "ended", "club_confirmed"].includes(body.workingStatus)) {
      update.working_status = body.workingStatus;
    }
    if (["self_reported", "location_confirmed", "club_confirmed"].includes(body.locationStatus)) {
      update.location_status = body.locationStatus;
    }
    if (typeof body.checkedInAt === "string" || body.checkedInAt === null) update.checked_in_at = body.checkedInAt;
    if (typeof body.checkedOutAt === "string" || body.checkedOutAt === null) update.checked_out_at = body.checkedOutAt;
    if (typeof body.commissionTrackingStartedAt === "string" || body.commissionTrackingStartedAt === null) {
      update.commission_tracking_started_at = body.commissionTrackingStartedAt;
    }
    if (typeof body.commissionTrackingStoppedAt === "string" || body.commissionTrackingStoppedAt === null) {
      update.commission_tracking_stopped_at = body.commissionTrackingStoppedAt;
    }
    if (typeof body.endedAt === "string" || body.endedAt === null) update.ended_at = body.endedAt;
    if (typeof body.endedReason === "string" || body.endedReason === null) update.ended_reason = body.endedReason;
    if (body.shiftSummary && typeof body.shiftSummary === "object") update.shift_summary = body.shiftSummary;

    const nextStartsAt = typeof update.starts_at === "string" ? update.starts_at : existingShift.starts_at;
    const nextEndsAt = typeof update.ends_at === "string" ? update.ends_at : existingShift.ends_at;
    if (!isValidShiftRange(nextStartsAt, nextEndsAt)) {
      return NextResponse.json({ ok: false, error: "Shift end must be after shift start." }, { status: 400 });
    }

    const cancellingShift = update.status === "cancelled" && existingShift.status !== "cancelled";
    const { error } = await (client as any)
      .from("shifts")
      .update(update)
      .eq("id", body.shiftId)
      .eq("dancer_id", dancer.id);

    if (error) throw error;

    const cancellationRecipients = cancellingShift
      ? await broadcastShiftCancelled(dancer, existingShift)
      : 0;

    return NextResponse.json({ ok: true, cancellationRecipients });
  } catch (error) {
    return apiError(error, "Unable to update dancer shift.");
  }
}

async function getOwnShift(client: any, dancerId: string, shiftId: string) {
    const { data, error } = await client
    .from("shifts")
    .select("id, venue_id, starts_at, ends_at, status, venues(name)")
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shift not found.");

  return data;
}

async function getVenueForShift(client: any, venueId: string) {
  const { data, error } = await client
    .from("venues")
    .select("id, timezone, is_active")
    .eq("id", venueId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.is_active) throw new Error("Active venue not found.");

  return {
    id: data.id,
    timezone: data.timezone || "America/Los_Angeles",
  };
}

async function getOwnDancerProfile(client: any, userId: string) {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id, stage_name, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");

  return data;
}

async function broadcastShiftPosted(
  dancer: { id: string; stage_name: string },
  shiftId: string,
  venueId: string,
  startsAt: string,
) {
  const admin = createAdminSupabaseClient() as any;
  const { data: followers, error: followersError } = await admin
    .from("follows")
    .select("customer_id")
    .eq("dancer_id", dancer.id)
    .eq("notifications_enabled", true);

  if (followersError) throw followersError;

  const rows = (followers || []).map((follow: { customer_id: string }) => ({
    recipient_id: follow.customer_id,
    notification_type: "shift_posted",
    channel: "in_app",
    title: `${dancer.stage_name} posted a shift`,
    body: `${dancer.stage_name} posted a new schedule. Tap to view details.`,
    payload: { dancerId: dancer.id, shiftId, venueId, startsAt },
    sent_at: new Date().toISOString(),
  }));

  if (!rows.length) return 0;

  const { error } = await admin.from("notifications").insert(rows);
  if (error) throw error;

  await deliverNotificationRows(admin, rows);

  return rows.length;
}

async function broadcastShiftCancelled(
  dancer: { id: string; stage_name: string },
  shift: { id: string; venue_id: string; starts_at: string; status: string; venues?: { name?: string } | { name?: string }[] | null },
) {
  const admin = createAdminSupabaseClient() as any;
  const [{ data: follows, error: followsError }, { data: goingSignals, error: goingError }] = await Promise.all([
    admin
      .from("follows")
      .select("customer_id")
      .eq("dancer_id", dancer.id)
      .eq("notifications_enabled", true),
    admin
      .from("going_signals")
      .select("customer_id")
      .eq("shift_id", shift.id),
  ]);

  if (followsError) throw followsError;
  if (goingError) throw goingError;

  const recipientIds = Array.from(new Set([
    ...(follows || []).map((follow: { customer_id: string }) => follow.customer_id),
    ...(goingSignals || []).map((signal: { customer_id: string }) => signal.customer_id),
  ]));

  if (!recipientIds.length) return 0;

  const { data: profiles, error: profileError } = await admin
    .from("customer_profiles")
    .select("user_id, notification_settings")
    .in("user_id", recipientIds);

  if (profileError) throw profileError;

  const enabledRecipients = (profiles || [])
    .filter((profile: { user_id: string; notification_settings?: Record<string, unknown> | null }) => {
      return profile.notification_settings?.cancelledShifts !== false;
    })
    .map((profile: { user_id: string }) => profile.user_id);

  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  const venueName = venue?.name ? ` at ${venue.name}` : "";
  const rows = enabledRecipients.map((recipientId: string) => ({
    recipient_id: recipientId,
    notification_type: "shift_cancelled",
    channel: "in_app",
    title: `${dancer.stage_name} cancelled a shift`,
    body: `${dancer.stage_name}'s shift${venueName} was cancelled.`,
    payload: { dancerId: dancer.id, shiftId: shift.id, venueId: shift.venue_id, startsAt: shift.starts_at },
    sent_at: new Date().toISOString(),
  }));

  if (!rows.length) return 0;

  const { error } = await admin.from("notifications").insert(rows);
  if (error) throw error;

  await deliverNotificationRows(admin, rows);

  return rows.length;
}
