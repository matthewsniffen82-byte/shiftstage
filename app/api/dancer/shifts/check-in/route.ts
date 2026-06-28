import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_IN_RADIUS_FEET = 300;
const CHECK_IN_LEAD_TIME_MS = 2 * 60 * 60 * 1000;

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
    const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;

    if (shift.checked_in_at) {
      return NextResponse.json({ ok: false, error: "This shift is already checked in." }, { status: 409 });
    }

    if (!isCheckInWindowOpen(shift)) {
      return NextResponse.json(
        { ok: false, error: "Check-in is only available near your scheduled shift time." },
        { status: 403 },
      );
    }

    if (!Number.isFinite(Number(venue?.latitude)) || !Number.isFinite(Number(venue?.longitude))) {
      return NextResponse.json({ ok: false, error: "Club location is not set for check-in." }, { status: 400 });
    }

    const distanceFeet = distanceInFeet(latitude, longitude, Number(venue.latitude), Number(venue.longitude));
    if (distanceFeet > CHECK_IN_RADIUS_FEET) {
      return NextResponse.json({ ok: false, error: "You must be near the club to check in." }, { status: 403 });
    }

    const checkedInAt = new Date().toISOString();
    const { data, error } = await (client as any)
      .from("shifts")
      .update({
        checked_in_at: checkedInAt,
        checked_out_at: null,
        checkin_latitude: latitude,
        checkin_longitude: longitude,
        checkin_distance_feet: Math.round(distanceFeet * 100) / 100,
        location_status: "location_confirmed",
      })
      .eq("id", shiftId)
      .eq("dancer_id", dancer.id)
      .is("checked_in_at", null)
      .select("id, checked_in_at, checked_out_at, checkin_distance_feet, location_status")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, shift: data });
  } catch (error) {
    return apiError(error, "Unable to check in.");
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

    if (shift.checked_out_at) {
      return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    }

    const { data, error } = await (client as any)
      .from("shifts")
      .update({
        checked_out_at: new Date().toISOString(),
        location_status: "self_reported",
      })
      .eq("id", shiftId)
      .eq("dancer_id", dancer.id)
      .is("checked_out_at", null)
      .select("id, checked_in_at, checked_out_at, checkin_distance_feet, location_status")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, shift: data });
  } catch (error) {
    return apiError(error, "Unable to check out.");
  }
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
      "id, dancer_id, starts_at, ends_at, timezone, status, checked_in_at, checked_out_at, venues(id, name, latitude, longitude, timezone)",
    )
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shift not found.");
  if (data.status !== "posted") throw new Error("Only posted shifts can be checked in.");

  return data;
}

function isCheckInWindowOpen(shift: { starts_at: string; ends_at: string; timezone?: string | null }) {
  const now = new Date();
  const startsAt = new Date(shift.starts_at);
  const endsAt = new Date(shift.ends_at);
  const opensAt = new Date(startsAt.getTime() - CHECK_IN_LEAD_TIME_MS);

  return isSameLocalDay(now, startsAt, shift.timezone || "America/Los_Angeles") && now >= opensAt && now <= endsAt;
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
