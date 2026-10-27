import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { mainPhotoPreviews } from "@/src/lib/dancr/media-review-main-photo";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: Record<string, unknown>) => NextResponse.json(body, { headers: { "cache-control": "private, no-store, max-age=0" } });

async function context(request: Request) {
  const { client, user } = await createRequestSupabaseContext(request);
  await requireActiveVenueAccount(client, user.id);
  const admin = createAdminSupabaseClient();
  const access = await requireVenueAccess(admin, user.id, "manage_roster");
  return { admin, user, access };
}

export async function GET(request: Request) {
  try {
    const { admin, access } = await context(request);
    const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new PublicApiError("INVALID_REQUEST", "Invalid request page.", 400);
    const { data, error } = await admin.from("club_dancer_approvals")
      .select("dancer_id, status, requested_at, revision, dancer_profiles!inner(id, user_id, stage_name, city, status, disabled_at)")
      .eq("venue_id", access.venueId).in("status", ["pending", "rejected"])
      .is("dancer_profiles.disabled_at", null).in("dancer_profiles.status", ["pending_review", "approved"])
      .order("requested_at", { ascending: false }).order("dancer_id").range(offset, offset + 25);
    if (error) throw error;
    const previews = await mainPhotoPreviews(admin, (data || []).slice(0, 25).map(row => row.dancer_id));
    const requests = await Promise.all((data || []).slice(0, 25).map(async row => {
      const dancer = Array.isArray(row.dancer_profiles) ? row.dancer_profiles[0] : row.dancer_profiles;
      const { data: enrollment, error: enrollmentError } = await admin.from("dancer_nfc_enrollments")
        .select("expires_at, nfc_tags(status)").eq("venue_id", access.venueId).eq("dancer_user_id", dancer.user_id).eq("status", "pending").maybeSingle();
      if (enrollmentError) throw enrollmentError;
      const tag = Array.isArray(enrollment?.nfc_tags) ? enrollment.nfc_tags[0] : enrollment?.nfc_tags;
      const expired = !enrollment || tag?.status !== "active" || Date.parse(enrollment.expires_at) <= Date.now();
      return { dancerId: row.dancer_id, stageName: dancer.stage_name, city: dancer.city, status: row.status,
        requestedAt: row.requested_at, revision: row.revision, expired, avatarUrl: expired ? null : previews.get(row.dancer_id) || null };
    }));
    return json({ ok: true, requests, hasMore: (data?.length || 0) > 25 });
  } catch (error) { return apiError(error, "Unable to load club approval requests."); }
}

export async function POST(request: Request) {
  try {
    const { admin, user, access } = await context(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid club approval request.", tooLargeMessage: "Club approval request is too large." });
    if (typeof body.dancerId !== "string" || !uuid.test(body.dancerId) || typeof body.revision !== "string" || !uuid.test(body.revision)
      || !["approved", "rejected"].includes(String(body.decision))) throw new PublicApiError("INVALID_REQUEST", "Choose a dancer and an approval decision.", 400);
    const { data, error } = await admin.rpc("review_club_dancer_approval_and_check_in", {
      p_actor_user_id: user.id, p_venue_id: access.venueId, p_dancer_id: body.dancerId, p_revision: body.revision, p_decision: body.decision,
    });
    if (error) {
      if (error.message?.includes("CLUB_PROFILE_MEDIA_REVIEW_REQUIRED")) throw new PublicApiError("CONFLICT", "Review every photo and video, and approve at least one profile photo before approving this profile.", 409);
      if (["40001", "P0002"].includes(error.code)) throw new PublicApiError("CONFLICT", "This request changed or expired. Refresh the requests. An expired request needs a new club tap.", 409);
      if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "An active club owner or manager must review this request.", 403);
      throw error;
    }
    const requiresNewTap = body.decision === "approved" && ["tap_expired", "tag_inactive", "access_removed", "visibility_required"].includes(data?.checkInStatus);
    // During rollout, older database receipts requested a retap for any wait.
    // Accept that legacy flag only for known waiting states, and normalize it.
    const legacyWaiting = body.decision === "approved" && data?.shiftCheckedIn === false && data.requiresNewTap === true
      && ["profile_pending", "media_pending", "active_other_club", "cooldown"].includes(data.checkInStatus);
    if (data?.venueId !== access.venueId || data.dancerId !== body.dancerId || data.status !== body.decision
      || typeof data.revision !== "string" || !uuid.test(data.revision)
      || typeof data.shiftCheckedIn !== "boolean" || (data.requiresNewTap !== requiresNewTap && !legacyWaiting)
      || data.affiliationActivated !== (body.decision === "approved")
      || (data.shiftCheckedIn && (body.decision !== "approved" || data.checkInStatus !== "checked_in"
        || typeof data.shiftId !== "string" || !uuid.test(data.shiftId) || !Number.isFinite(Date.parse(data.workingUntil))))
      || (!data.shiftCheckedIn && !["not_approved", "tap_expired", "profile_pending", "media_pending", "active_other_club", "cooldown", "age_pending", "agreement_pending", "tag_inactive", "access_removed", "visibility_required"].includes(data.checkInStatus))) {
      throw new PublicApiError("UNAVAILABLE", "The decision could not be confirmed. Refresh before trying again.", 503);
    }
    return json({ ok: true, ...data, requiresNewTap });
  } catch (error) { return apiError(error, "Unable to review this club approval request."); }
}
