import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { reconcileExpiredDancerShifts } from "@/src/lib/dancr/shift-lifecycle";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let stage = "auth";
  const startedAt = Date.now();
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const admin = createAdminSupabaseClient() as any;
    stage = "profile";
    const dancer = await getOwnDancerProfile(admin, user.id);
    // Cleanup must not prevent reading the current check-in. Expired rows are
    // never active, even if their final summary could not be saved yet.
    stage = "reconciliation";
    try { await reconcileExpiredDancerShifts(admin, dancer.id); }
    catch (error) { console.error("DANCER_SHIFT_RECONCILIATION_FAILED", safeErrorMetadata(error)); }
    stage = "shift_list";
    const shiftRead = admin
        .from("shifts")
        .select("id, venue_id, shift_date, shift_source, nfc_tag_id, nfc_last_tapped_at, starts_at, ends_at, timezone, status, broadcast_sent_at, broadcast_recipients, location_status, checked_in_at, checked_out_at, checkin_distance_feet, checkin_accuracy_meters, last_location_verified_at, location_verification_expires_at, working_status, commission_tracking_started_at, commission_tracking_stopped_at, ended_at, ended_reason, shift_summary, venues(name, slug, city, latitude, longitude)")
        .eq("dancer_id", dancer.id)
        .not("checked_in_at", "is", null)
        .order("starts_at", { ascending: false })
        .limit(25);

    // Ranking progress is optional: a failed metrics read must not hide the
    // active shift or prevent the dancer from checking out.
    const progressRead = async () => {
      try {
        const result = await admin.rpc("get_dancer_shift_ranking_progress", { p_dancer_id: dancer.id });
        return !result.error && Array.isArray(result.data) ? result.data : [];
      } catch { return []; }
    };
    const [{ data, error }, progress] = await Promise.all([shiftRead, progressRead()]);
    if (error) throw error;
    return noStoreJson({ ok: true, shifts: (data || []).map((shift: { id: string }) => ({ ...shift,
      rankingProgress: progress.find((row: { shiftId: string }) => row.shiftId === shift.id) || null,
    })), venues: [] });
  } catch (error) {
    const response = apiError(error, "Unable to load dancer shifts.");
    if (response.status >= 500) console.error("DANCER_SHIFT_READ_FAILED", { stage, durationMs: Date.now() - startedAt, ...safeErrorMetadata(error) });
    return response;
  }
}

async function retiredSchedule(request: Request) {
  try {
    await createRequestSupabaseContext(request, { role: "dancer" });
    return NextResponse.json({ ok: false, code: "upcoming_shifts_retired", error: "Upcoming shift posts are no longer available. Tap the club’s dancer check-in tag to start Working Now." }, { status: 410, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to verify your dancer account."); }
}

export const POST = retiredSchedule;
export const PATCH = retiredSchedule;
export const DELETE = retiredSchedule;

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
  if (!data) throw new PublicApiError("NOT_FOUND", "Dancer profile not found.", 404);

  return data;
}
