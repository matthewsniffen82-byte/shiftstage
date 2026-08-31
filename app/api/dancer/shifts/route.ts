import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { broadcastFollowedDancerUpcomingShift } from "@/src/lib/dancr/customer-follow-notifications";
import { getScheduleDateWindow, isValidScheduleDate, localDateInTimeZone } from "@/src/lib/dancr/schedule";
import {
  createScheduledDancerShift,
  type DancerShiftUpdate,
  reconcileExpiredDancerShifts,
  recordDancerShiftBroadcast,
  updateOwnedDancerShift,
} from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SHIFT_BODY_BYTES = 4_096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const dancer = await getOwnDancerProfile(client as any, user.id);
    const admin = createAdminSupabaseClient() as any;
    await reconcileExpiredDancerShifts(admin, dancer.id);
    const [{ data, error }, venues] = await Promise.all([
      admin
        .from("shifts")
        .select("id, venue_id, shift_date, shift_source, nfc_tag_id, nfc_last_tapped_at, starts_at, ends_at, timezone, status, broadcast_sent_at, broadcast_recipients, location_status, checked_in_at, checked_out_at, checkin_distance_feet, checkin_accuracy_meters, last_location_verified_at, location_verification_expires_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at, ended_at, ended_reason, shift_summary, venues(name, slug, city, latitude, longitude)")
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
    const body = await readShiftBody(request);
    const dancer = await getOwnDancerProfile(client as any, user.id);

    if (dancer.status !== "approved") {
      return NextResponse.json({ ok: false, error: "Profile approval required before posting shifts." }, { status: 403 });
    }

    const venueId = readUuid(body.venueId);
    if (!venueId) {
      return NextResponse.json({ ok: false, error: "Choose a venue." }, { status: 400 });
    }

    const venue = await getAffiliatedVenueForShift(createAdminSupabaseClient() as any, dancer.id, venueId);
    if (!venue) {
      return NextResponse.json(
        { ok: false, error: "Tap this venue's official MyDancr dressing-room sticker before posting a shift there." },
        { status: 403 },
      );
    }
    const timezone = venue.timezone;
    const shiftDate = requestedShiftDate(body, timezone);
    if (!shiftDate || !isValidScheduleDate(shiftDate, timezone)) {
      return NextResponse.json({ ok: false, error: "Choose a valid upcoming date." }, { status: 400 });
    }
    const window = getScheduleDateWindow(shiftDate, timezone);

    const data = await createScheduledDancerShift(client as any, {
      dancerId: dancer.id,
      venueId,
      shiftDate,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      timezone,
    });

    const broadcastRecipients = await broadcastFollowedDancerUpcomingShift(
      createAdminSupabaseClient(),
      {
        dancerId: dancer.id,
        eventId: data.id,
        shiftDate,
        stageName: dancer.stage_name,
        venueId,
        venueName: venue.name,
        venueSlug: venue.slug,
      },
    );
    await recordDancerShiftBroadcast(client as any, dancer.id, data.id, broadcastRecipients);

    return NextResponse.json({ ok: true, shiftId: data.id, broadcastRecipients });
  } catch (error) {
    return apiError(error, "Unable to post dancer shift.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await readShiftBody(request);

    const shiftId = readUuid(body.shiftId);
    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    const dancer = await getOwnDancerProfile(client as any, user.id);
    const existingShift = await getOwnShift(client as any, dancer.id, shiftId);
    if (existingShift.shift_source === "demo_locked") {
      return NextResponse.json(
        { ok: false, error: "Demo Mode Working Now assignments are managed centrally." },
        { status: 409 },
      );
    }
    const update: DancerShiftUpdate = {};
    let nextTimezone = existingShift.timezone || "America/Los_Angeles";
    if (body.venueId !== undefined) {
      const venueId = readUuid(body.venueId);
      if (!venueId) {
        return NextResponse.json({ ok: false, error: "Choose a valid venue." }, { status: 400 });
      }
      const venue = await getAffiliatedVenueForShift(createAdminSupabaseClient() as any, dancer.id, venueId);
      if (!venue) {
        return NextResponse.json(
          { ok: false, error: "Tap this venue's official MyDancr dressing-room sticker before moving a shift there." },
          { status: 403 },
        );
      }
      update.venue_id = venueId;
      update.timezone = venue.timezone;
      nextTimezone = venue.timezone;
    }
    if (body.status === "posted" || body.status === "cancelled" || body.status === "draft") {
      update.status = body.status;
    }

    const editingSchedule = typeof body.shiftDate === "string" || typeof body.startsAt === "string" || typeof body.venueId === "string";
    if (editingSchedule) {
      if (existingShift.shift_source === "nfc_presence") {
        return NextResponse.json({ ok: false, error: "Working Now sessions cannot be edited." }, { status: 409 });
      }
      const shiftDate = requestedShiftDate(body, nextTimezone) || existingShift.shift_date;
      if (!shiftDate || !isValidScheduleDate(shiftDate, nextTimezone)) {
        return NextResponse.json({ ok: false, error: "Choose a valid upcoming date." }, { status: 400 });
      }
      const window = getScheduleDateWindow(shiftDate, nextTimezone);
      update.shift_date = shiftDate;
      update.shift_source = "scheduled";
      update.starts_at = window.startsAt;
      update.ends_at = window.endsAt;
    }

    if (existingShift.checked_in_at && !existingShift.checked_out_at && Object.keys(update).length) {
      return NextResponse.json(
        { ok: false, error: "Check out before editing or cancelling an active shift." },
        { status: 409 },
      );
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ ok: false, error: "No editable shift fields were provided." }, { status: 400 });
    }

    await updateOwnedDancerShift(client as any, dancer.id, shiftId, update);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update dancer shift.");
  }
}

async function getOwnShift(client: any, dancerId: string, shiftId: string) {
    const { data, error } = await client
    .from("shifts")
    .select("id, venue_id, shift_date, shift_source, starts_at, ends_at, timezone, status, checked_in_at, checked_out_at, venues(name)")
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shift not found.");

  return data;
}

function readShiftBody(request: Request) {
  return readBoundedJsonObject(request, {
    maxBytes: MAX_SHIFT_BODY_BYTES,
    invalidMessage: "Invalid dancer shift request.",
    tooLargeMessage: "Dancer shift request is too large.",
  });
}

function readUuid(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(candidate) ? candidate : "";
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
    .select("venue_id, venues!inner(id, slug, name, timezone, is_active)")
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
    name: venue.name,
    slug: venue.slug,
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

function requestedShiftDate(body: Record<string, unknown>, timeZone: string) {
  if (typeof body.shiftDate === "string") return body.shiftDate.trim();
  if (typeof body.startsAt === "string") {
    const legacyDate = new Date(body.startsAt);
    if (Number.isFinite(legacyDate.getTime())) return localDateInTimeZone(timeZone, legacyDate);
  }
  return "";
}
