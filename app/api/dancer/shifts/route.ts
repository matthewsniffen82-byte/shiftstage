import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { deliverNotificationRows } from "@/src/lib/dancr/notification-delivery";
import { isValidShiftRange } from "@/src/lib/dancr/schedule";
import { reconcileExpiredDancerShifts } from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const dancer = await getOwnDancerProfile(client as any, user.id);
    const admin = createAdminSupabaseClient() as any;
    await reconcileExpiredDancerShifts(admin, dancer.id);
    const [{ data, error }, venues] = await Promise.all([
      admin
        .from("shifts")
        .select("id, venue_id, starts_at, ends_at, timezone, status, broadcast_sent_at, broadcast_recipients, location_status, checked_in_at, checked_out_at, checkin_distance_feet, checkin_accuracy_meters, last_location_verified_at, location_verification_expires_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at, ended_at, ended_reason, shift_summary, venues(name, slug, city, latitude, longitude)")
        .eq("dancer_id", dancer.id)
        .order("starts_at", { ascending: false })
        .limit(25),
      getApprovedShiftVenues(admin, dancer.id),
    ]);

    if (error) throw error;

    return noStoreJson({ ok: true, shifts: data || [], venues });
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

    const venue = await getAffiliatedVenueForShift(createAdminSupabaseClient() as any, dancer.id, body.venueId);
    if (!venue) {
      return NextResponse.json(
        { ok: false, error: "This venue must approve your affiliation before you can post a shift there." },
        { status: 403 },
      );
    }
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
      const venue = await getAffiliatedVenueForShift(createAdminSupabaseClient() as any, dancer.id, body.venueId);
      if (!venue) {
        return NextResponse.json(
          { ok: false, error: "This venue must approve your affiliation before you can move a shift there." },
          { status: 403 },
        );
      }
      update.venue_id = body.venueId;
      update.timezone = venue.timezone;
    }
    if (typeof body.startsAt === "string") update.starts_at = body.startsAt;
    if (typeof body.endsAt === "string") update.ends_at = body.endsAt;
    if (typeof body.timezone === "string") update.timezone = body.timezone;
    if (["posted", "cancelled", "draft"].includes(body.status)) update.status = body.status;

    if (existingShift.checked_in_at && !existingShift.checked_out_at && Object.keys(update).length) {
      return NextResponse.json(
        { ok: false, error: "Check out before editing or cancelling an active shift." },
        { status: 409 },
      );
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ ok: false, error: "No editable shift fields were provided." }, { status: 400 });
    }

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
    .select("id, venue_id, starts_at, ends_at, status, checked_in_at, checked_out_at, venues(name)")
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shift not found.");

  return data;
}

async function getApprovedShiftVenues(client: any, dancerId: string) {
  const { data, error } = await client
    .from("venue_dancer_affiliations")
    .select("venue_id, approved_at, venues!inner(id, slug, name, city, timezone, is_active)")
    .eq("dancer_id", dancerId)
    .eq("status", "active")
    .is("revoked_at", null)
    .eq("venues.is_active", true)
    .order("approved_at", { ascending: true });

  if (error) throw error;

  return (data || []).flatMap((row: any) => {
    const venue = Array.isArray(row.venues) ? row.venues[0] : row.venues;
    if (!venue?.id || venue.is_active === false) return [];
    return [{
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      city: venue.city,
      timezone: venue.timezone || "America/Los_Angeles",
    }];
  });
}

async function getAffiliatedVenueForShift(client: any, dancerId: string, venueId: string) {
  const { data, error } = await client
    .from("venue_dancer_affiliations")
    .select("venue_id, venues!inner(id, timezone, is_active)")
    .eq("dancer_id", dancerId)
    .eq("venue_id", venueId)
    .eq("status", "active")
    .is("revoked_at", null)
    .eq("venues.is_active", true)
    .maybeSingle();

  if (error) throw error;
  const venue = Array.isArray(data?.venues) ? data.venues[0] : data?.venues;
  if (!data || !venue?.id || venue.is_active === false) return null;

  return {
    id: venue.id,
    timezone: venue.timezone || "America/Los_Angeles",
  };
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
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
