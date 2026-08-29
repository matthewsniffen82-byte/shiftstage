import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { endDancerShift } from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SHIFT_ACTION_BODY_BYTES = 2_048;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST() {
  return nfcRequiredResponse();
}

export async function PATCH(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const body = await readShiftActionBody(request);
    const action = typeof body.action === "string" ? body.action : "";
    const shiftId = readShiftId(body);
    if (!shiftId) return missingShiftIdResponse();

    if (action === "refresh") return nfcRequiredResponse();

    if (action !== "end" && action !== "auto_end") {
      return NextResponse.json({ ok: false, error: "Unknown shift action." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient() as any;
    const dancer = await getOwnDancerProfile(admin, user.id);
    const shift = await getOwnShift(admin, dancer.id, shiftId);
    if (shift.shift_source === "demo_locked") return demoAssignmentResponse();
    if (!shift.checked_in_at) {
      return NextResponse.json({ ok: false, error: "This shift has not been checked in." }, { status: 400 });
    }
    if (shift.checked_out_at || shift.working_status === "ended") {
      return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    }
    const ended = await endDancerShift(admin, dancer.id, shift, "manual");
    if (!ended) return NextResponse.json({ ok: false, error: "This shift is already checked out." }, { status: 409 });
    console.info("Dancer shift ended", { shiftId, dancerId: dancer.id, reason: action });
    return NextResponse.json({ ok: true, shift: ended });
  } catch (error) {
    return apiError(error, "Unable to update club check-in.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const body = await readShiftActionBody(request);
    const shiftId = readShiftId(body);
    if (!shiftId) return missingShiftIdResponse();

    const admin = createAdminSupabaseClient() as any;
    const dancer = await getOwnDancerProfile(admin, user.id);
    const shift = await getOwnShift(admin, dancer.id, shiftId);
    if (shift.shift_source === "demo_locked") return demoAssignmentResponse();
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
      "id, dancer_id, shift_source, starts_at, ends_at, status, checked_in_at, checked_out_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at",
    )
    .eq("id", shiftId)
    .eq("dancer_id", dancerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Shift not found.");
  if (data.status !== "posted") throw new Error("Only posted shifts can be checked in.");
  return data;
}

function readShiftActionBody(request: Request) {
  return readBoundedJsonObject(request, {
    maxBytes: MAX_SHIFT_ACTION_BODY_BYTES,
    invalidMessage: "Invalid shift action request.",
    tooLargeMessage: "Shift action request is too large.",
  });
}

function readShiftId(body: Record<string, unknown>) {
  const shiftId = typeof body.shiftId === "string" ? body.shiftId.trim() : "";
  return UUID_PATTERN.test(shiftId) ? shiftId : "";
}

function missingShiftIdResponse() {
  return NextResponse.json({ ok: false, error: "Missing shiftId." }, { status: 400 });
}

function nfcRequiredResponse() {
  return NextResponse.json({
    ok: false,
    code: "nfc_tap_required",
    error: "Tap the venue's official MyDancr dressing-room sticker to go Working Now. Phone-location check-in is no longer used.",
  }, { status: 410 });
}

function demoAssignmentResponse() {
  return NextResponse.json(
    { ok: false, code: "demo_assignment_locked", error: "Demo Mode Working Now assignments are managed centrally." },
    { status: 409 },
  );
}
