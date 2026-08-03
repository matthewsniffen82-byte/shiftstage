import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { validateClientLocationReading } from "@/src/lib/dancr/geofence";
import { endDancerShift } from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return verifyLocation(request, "check_in");
}

export async function PATCH(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const body = await readJsonBody(request);
    const action = typeof body.action === "string" ? body.action : "";
    const shiftId = readShiftId(body);
    if (!shiftId) return missingShiftIdResponse();

    if (action === "refresh") return verifyAuthenticatedLocation(user.id, shiftId, body, "refresh");

    if (action !== "end" && action !== "auto_end") {
      return NextResponse.json({ ok: false, error: "Unknown shift action." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient() as any;
    const dancer = await getOwnDancerProfile(admin, user.id);
    const shift = await getOwnShift(admin, dancer.id, shiftId);
    if (!shift.checked_in_at) {
      return NextResponse.json({ ok: false, error: "This shift has not been checked in." }, { status: 400 });
    }
    if (shift.checked_out_at || shift.working_status === "ended") {
      return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    }
    if (action === "auto_end" && new Date(shift.ends_at).getTime() > Date.now()) {
      return NextResponse.json({ ok: false, error: "This shift has not ended yet." }, { status: 403 });
    }

    const ended = await endDancerShift(admin, dancer.id, shift, action === "auto_end" ? "automatic" : "manual");
    if (!ended) return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    console.info("Dancer shift ended", { shiftId, dancerId: dancer.id, reason: action });
    return NextResponse.json({ ok: true, shift: ended });
  } catch (error) {
    return apiError(error, "Unable to update check-in.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const body = await readJsonBody(request);
    const shiftId = readShiftId(body);
    if (!shiftId) return missingShiftIdResponse();

    const admin = createAdminSupabaseClient() as any;
    const dancer = await getOwnDancerProfile(admin, user.id);
    const shift = await getOwnShift(admin, dancer.id, shiftId);
    if (!shift.checked_in_at) {
      return NextResponse.json({ ok: false, error: "This shift has not been checked in." }, { status: 400 });
    }
    if (shift.checked_out_at || shift.working_status === "ended") {
      return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    }

    const ended = await endDancerShift(admin, dancer.id, shift, "manual");
    if (!ended) return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    console.info("Dancer shift ended", { shiftId, dancerId: dancer.id, reason: "manual" });
    return NextResponse.json({ ok: true, shift: ended });
  } catch (error) {
    return apiError(error, "Unable to check out.");
  }
}

async function verifyLocation(request: Request, eventType: "check_in" | "refresh") {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const body = await readJsonBody(request);
    const shiftId = readShiftId(body);
    if (!shiftId) return missingShiftIdResponse();
    return verifyAuthenticatedLocation(user.id, shiftId, body, eventType);
  } catch (error) {
    return apiError(error, "Unable to check in.");
  }
}

async function verifyAuthenticatedLocation(
  userId: string,
  shiftId: string,
  body: Record<string, unknown>,
  eventType: "check_in" | "refresh",
) {
  const validation = validateClientLocationReading(body);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, code: validation.code, error: validation.error },
      { status: 400 },
    );
  }

  const admin = createAdminSupabaseClient() as any;
  const { data, error } = await admin.rpc("process_dancer_location_verification", {
    p_user_id: userId,
    p_shift_id: shiftId,
    p_event_type: eventType,
    p_latitude: validation.reading.latitude,
    p_longitude: validation.reading.longitude,
    p_accuracy_meters: validation.reading.accuracyMeters,
    p_captured_at: validation.reading.capturedAt,
  });
  if (error) throw error;

  const status = boundedHttpStatus(data?.status);
  if (data?.ok !== true) {
    console.warn("Dancer shift geofence rejected", {
      shiftId,
      eventType,
      code: String(data?.code || "verification_failed"),
      distanceFeet: Number.isFinite(Number(data?.distanceFeet)) ? Number(data.distanceFeet) : undefined,
      accuracyMeters: validation.reading.accuracyMeters,
    });
    const headers = status === 429 ? { "retry-after": "60" } : undefined;
    return NextResponse.json(data || { ok: false, error: "Unable to verify location." }, { status, headers });
  }

  console.info("Dancer shift geofence accepted", {
    shiftId,
    eventType,
    distanceFeet: Number(data?.shift?.checkin_distance_feet || 0),
    accuracyMeters: validation.reading.accuracyMeters,
  });
  return NextResponse.json(data, { status: 200 });
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

async function getOwnShift(client: any, dancerId: string, shiftId: string) {
  const { data, error } = await client
    .from("shifts")
    .select(
      "id, dancer_id, starts_at, ends_at, status, checked_in_at, checked_out_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at",
    )
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Shift not found.");
  if (data.status !== "posted") throw new Error("Only posted shifts can be checked in.");
  return data;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function readShiftId(body: Record<string, unknown>) {
  return typeof body.shiftId === "string" ? body.shiftId.trim() : "";
}

function missingShiftIdResponse() {
  return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
}

function boundedHttpStatus(value: unknown) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
}
