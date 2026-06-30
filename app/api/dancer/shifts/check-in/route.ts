import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_IN_RADIUS_FEET = 300;
const CHECK_IN_LEAD_TIME_MS = 2 * 60 * 60 * 1000;
const MAX_SHIFT_LENGTH_MS = 12 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);

    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ ok: false, error: "Location permission is required to check in." }, { status: 400 });
    }

    const dancer = await getOwnDancerProfile(client as any, user.id);
    const shift = await getOwnShiftWithVenue(client as any, dancer.id, shiftId);

    if (shift.checked_in_at && shift.working_status !== "ended") {
      return NextResponse.json({ ok: false, error: "This shift is already checked in." }, { status: 409 });
    }

    if (!isCheckInWindowOpen(shift)) {
      return NextResponse.json(
        { ok: false, error: "Check-in is only available near your scheduled shift time." },
        { status: 403 },
      );
    }

    const geofence = verifyGeofence(shift, latitude, longitude, "You must be near the club to check in.");
    if ("response" in geofence) return geofence.response;

    const checkedInAt = new Date().toISOString();
    const { data, error } = await (client as any)
      .from("shifts")
      .update({
        checked_in_at: shift.checked_in_at || checkedInAt,
        checked_out_at: null,
        checkin_latitude: latitude,
        checkin_longitude: longitude,
        checkin_distance_feet: geofence.distanceFeet,
        location_status: "location_confirmed",
        working_status: "checked_in",
        commission_tracking_started_at: shift.commission_tracking_started_at || checkedInAt,
        commission_tracking_stopped_at: null,
        ended_at: null,
        ended_reason: null,
      })
      .eq("id", shiftId)
      .eq("dancer_id", dancer.id)
      .select(shiftStateSelect())
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, shift: data });
  } catch (error) {
    return apiError(error, "Unable to check in.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";
    const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";

    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    const dancer = await getOwnDancerProfile(client as any, user.id);
    const shift = await getOwnShiftWithVenue(client as any, dancer.id, shiftId);

    if (action === "end" || action === "auto_end") {
      const endedReason = action === "auto_end" ? "automatic" : "manual";
      return endShift(client as any, dancer.id, shiftId, endedReason);
    }

    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ ok: false, error: "Location permission is required to check in." }, { status: 400 });
    }

    if (action === "still_working") {
      if (!isShiftActive(shift)) {
        return NextResponse.json(
          { ok: false, error: "Check-in is only available near your scheduled shift time." },
          { status: 403 },
        );
      }
      const geofence = verifyGeofence(
        shift,
        latitude,
        longitude,
        "You must be at the venue to confirm you're still working.",
      );
      if ("response" in geofence) return geofence.response;

      const confirmedAt = new Date().toISOString();
      const { data, error } = await (client as any)
        .from("shifts")
        .update({
          still_working_confirmed_at: confirmedAt,
          still_working_expires_at: null,
          working_status: "checked_in",
          location_status: "location_confirmed",
          commission_tracking_stopped_at: null,
        })
        .eq("id", shiftId)
        .eq("dancer_id", dancer.id)
        .select(shiftStateSelect())
        .single();

      if (error) throw error;
      return NextResponse.json({ ok: true, shift: data });
    }

    if (action === "extend") {
      const minutes = Number(body?.minutes);
      if (![30, 60, 120].includes(minutes)) {
        return NextResponse.json({ ok: false, error: "Choose a valid shift extension." }, { status: 400 });
      }

      const geofence = verifyGeofence(shift, latitude, longitude, "You must be at the venue to extend your shift.");
      if ("response" in geofence) return geofence.response;

      const currentEnd = effectiveEndsAt(shift);
      const nextEnd = new Date(currentEnd.getTime() + minutes * 60 * 1000);
      const startsAt = new Date(shift.starts_at);
      if (nextEnd.getTime() - startsAt.getTime() > MAX_SHIFT_LENGTH_MS) {
        return NextResponse.json({ ok: false, error: "Maximum shift length is 12 hours." }, { status: 400 });
      }

      const nextEndIso = nextEnd.toISOString();
      const { data, error } = await (client as any)
        .from("shifts")
        .update({
          ends_at: nextEndIso,
          extended_ends_at: nextEndIso,
          working_status: "checked_in",
          location_status: "location_confirmed",
          commission_tracking_stopped_at: null,
        })
        .eq("id", shiftId)
        .eq("dancer_id", dancer.id)
        .select(shiftStateSelect())
        .single();

      if (error) throw error;
      return NextResponse.json({ ok: true, shift: data });
    }

    if (action === "check_in_again") {
      if (!isShiftActive(shift)) {
        return NextResponse.json(
          { ok: false, error: "If your shift has ended, extend it or create a new shift before checking in again." },
          { status: 403 },
        );
      }

      const geofence = verifyGeofence(shift, latitude, longitude, "You must be near the club to check in.");
      if ("response" in geofence) return geofence.response;

      const checkedInAt = new Date().toISOString();
      const { data, error } = await (client as any)
        .from("shifts")
        .update({
          checked_in_at: shift.checked_in_at || checkedInAt,
          checked_out_at: null,
          checkin_latitude: latitude,
          checkin_longitude: longitude,
          checkin_distance_feet: geofence.distanceFeet,
          location_status: "location_confirmed",
          working_status: "checked_in",
          commission_tracking_started_at: shift.commission_tracking_started_at || checkedInAt,
          commission_tracking_stopped_at: null,
          ended_at: null,
          ended_reason: null,
        })
        .eq("id", shiftId)
        .eq("dancer_id", dancer.id)
        .select(shiftStateSelect())
        .single();

      if (error) throw error;
      return NextResponse.json({ ok: true, shift: data });
    }

    return NextResponse.json({ ok: false, error: "Unknown shift action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to update check-in.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";

    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    const dancer = await getOwnDancerProfile(client as any, user.id);
    const shift = await getOwnShiftWithVenue(client as any, dancer.id, shiftId);

    if (!shift.checked_in_at) {
      return NextResponse.json({ ok: false, error: "This shift has not been checked in." }, { status: 400 });
    }

    if (shift.checked_out_at || shift.working_status === "ended") {
      return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    }

    return endShift(client as any, dancer.id, shiftId, "manual");
  } catch (error) {
    return apiError(error, "Unable to check out.");
  }
}

async function endShift(client: any, dancerId: string, shiftId: string, reason: string) {
  const endedAt = new Date().toISOString();
  const { data, error } = await client
    .from("shifts")
    .update({
      checked_out_at: endedAt,
      location_status: "self_reported",
      working_status: "ended",
      commission_tracking_stopped_at: endedAt,
      ended_at: endedAt,
      ended_reason: reason,
    })
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .select(shiftStateSelect())
    .single();

  if (error) throw error;
  return NextResponse.json({ ok: true, shift: data });
}

async function getOwnDancerProfile(client: any, userId: string) {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");
  if (data.status !== "approved") throw new Error("Profile approval required before posting shifts.");

  return data;
}

async function getOwnShiftWithVenue(client: any, dancerId: string, shiftId: string) {
  const { data, error } = await client
    .from("shifts")
    .select(
      "id, dancer_id, starts_at, ends_at, extended_ends_at, timezone, status, checked_in_at, checked_out_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at, venues(id, name, latitude, longitude, timezone)",
    )
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shift not found.");
  if (data.status !== "posted") throw new Error("Only posted shifts can be checked in.");

  return data;
}

function shiftStateSelect() {
  return "id, checked_in_at, checked_out_at, checkin_distance_feet, location_status, working_status, commission_tracking_started_at, commission_tracking_stopped_at, still_working_prompted_at, still_working_confirmed_at, still_working_expires_at, extended_ends_at, ended_at, ended_reason, shift_summary";
}

function isCheckInWindowOpen(shift: { starts_at: string; ends_at: string; extended_ends_at?: string | null; timezone?: string | null }) {
  const now = new Date();
  const startsAt = new Date(shift.starts_at);
  const endsAt = effectiveEndsAt(shift);
  const opensAt = new Date(startsAt.getTime() - CHECK_IN_LEAD_TIME_MS);

  return isSameLocalDay(now, startsAt, shift.timezone || "America/Los_Angeles") && now >= opensAt && now <= endsAt;
}

function isShiftActive(shift: { starts_at: string; ends_at: string; extended_ends_at?: string | null }) {
  const now = new Date();
  return now >= new Date(shift.starts_at) && now <= effectiveEndsAt(shift);
}

function effectiveEndsAt(shift: { ends_at: string; extended_ends_at?: string | null }) {
  return new Date(shift.extended_ends_at || shift.ends_at);
}

function verifyGeofence(shift: any, latitude: number, longitude: number, outsideMessage: string) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;

  if (!Number.isFinite(Number(venue?.latitude)) || !Number.isFinite(Number(venue?.longitude))) {
    return { response: NextResponse.json({ ok: false, error: "Club location is not set for check-in." }, { status: 400 }) };
  }

  const distanceFeet = distanceInFeet(latitude, longitude, Number(venue.latitude), Number(venue.longitude));
  if (distanceFeet > CHECK_IN_RADIUS_FEET) {
    return { response: NextResponse.json({ ok: false, error: outsideMessage }, { status: 403 }) };
  }

  return { distanceFeet: Math.round(distanceFeet * 100) / 100 };
}

function isSameLocalDay(left: Date, right: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(left) === formatter.format(right);
}

function distanceInFeet(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusFeet = 20902231;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadiusFeet * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
