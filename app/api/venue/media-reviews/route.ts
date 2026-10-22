import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { runWithServerJob } from "@/src/lib/server-job";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { approveReviewRecord, rejectReviewRecord, withSignedThumbnail } from "@/src/lib/dancr/image-review";
import { MYDANCR_TV_BUCKET, reviewMyDancrTvVideo } from "@/src/lib/dancr/tv";
import { finalizePendingDancerNfcEnrollment } from "@/src/lib/dancr/nfc";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { isBriefRejectionReason } from "@/src/lib/dancr/media-review-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown) => NextResponse.json(body, { headers: { "cache-control": "private, no-store, max-age=0" } });

async function context(request: Request) {
  const { client, session, user } = await createRequestSupabaseContext(request);
  await requireActiveVenueAccount(client, user.id);
  const admin = createAdminSupabaseClient() as any;
  const access = await requireVenueAccess(admin, user.id, "manage_roster");
  return { admin, access, user, session };
}

export async function GET(request: Request) {
  try {
    const { admin, access, user, session } = await context(request);
    const url = new URL(request.url);
    const offset = Math.max(0, Math.min(100000, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0));
    const { data, error } = await admin.rpc("get_venue_dancer_media_review", {
      p_actor_id: user.id, p_venue_id: access.venueId, p_offset: offset, p_limit: url.searchParams.get("countOnly") === "1" ? 0 : 12,
    });
    if (error) throw error;
    const items = await Promise.all((data?.items || []).map(async (item: any) => {
      const r = item.record, photo = item.kind === "photo";
      const processing = photo ? ["pending", "moderating", "moderation_retry"].includes(r.status) : r.status === "moderating";
      let previewUrl = "";
      if (photo) previewUrl = (await withSignedThumbnail(admin, r)).thumbnailUrl;
      else {
        const signed = await admin.storage.from(MYDANCR_TV_BUCKET).createSignedUrl(r.storage_path, 300);
        if (signed.error) throw signed.error;
        previewUrl = signed.data?.signedUrl || "";
      }
      const flags = r.category_flags || {};
      const recommendation = photo ? flags.ai_recommended_rejection ? "rejected" : flags.ai_recommended_approval ? "approved" : "review" : r.moderation_decision;
      return { id: item.id, kind: item.kind, stageName: item.stageName, version: r.updated_at, previewUrl,
        label: photo ? r.upload_context === "profile_avatar" ? "Avatar" : r.upload_context.startsWith("profile_main") ? "Main photo" : "Photo" : "Video",
        processing, canApprove: !processing && recommendation === "approved" && (photo || !r.upload_validation_pending),
        aiSummary: processing ? "AI checks running" : recommendation === "approved" ? "AI checks passed" : "AI checks did not pass",
        reasons: photo ? r.reason_codes || [] : r.moderation_reason_codes || [],
      };
    }));
    return json({ ok: true, venueId: access.venueId, count: data?.count || 0, items, session });
  } catch (error) { return apiError(error, "Unable to load your club’s media reviews."); }
}

export async function POST(request: Request) {
  try {
    return await runWithServerJob(async () => {
      const { admin, access, user, session } = await context(request);
      const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid media review.", tooLargeMessage: "Review notes are too long." });
      const { id, kind, decision, version } = body;
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (typeof id !== "string" || !uuid.test(id) || !["photo", "video"].includes(String(kind)) || !["approved", "rejected"].includes(String(decision))
        || typeof version !== "string" || !Number.isFinite(Date.parse(version)) || notes.length > 4000) {
        throw new PublicApiError("INVALID_REQUEST", "Choose an upload and a review decision.", 400);
      }
      if (decision === "rejected" && !isBriefRejectionReason(notes)) throw new PublicApiError("INVALID_REQUEST", "Enter a rejection reason in 1–3 words.", 400);
      const photo = kind === "photo";
      const { data: record, error } = await admin.from(photo ? "image_moderation_records" : "mydancr_tv_videos").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!record || (photo && !String(record.upload_context).startsWith("profile_"))) throw new PublicApiError("NOT_FOUND", "Upload not found.", 404);
      const dancerUserId = photo ? record.user_id : record.submitted_by;
      const authorization = await admin.rpc("assert_dancer_media_reviewer", { p_actor_id: user.id, p_dancer_user_id: dancerUserId, p_venue_id: access.venueId });
      if (authorization.error) throw new PublicApiError("FORBIDDEN", "This dancer is not connected to your club. Refresh the queue.", 403);
      if (record.updated_at !== version) throw new PublicApiError("CONFLICT", "This upload changed. Refresh before reviewing it.", 409);
      const passedChecks = photo
        ? record.category_flags?.ai_recommended_approval === true && record.category_flags?.ai_recommended_rejection !== true
        : record.moderation_decision === "approved";
      if (decision === "approved" && !passedChecks) throw new PublicApiError("CONFLICT", "This upload must pass automated checks before Club approval. Ask the dancer to retry or replace it.", 409);
      if (photo) {
        if (decision === "approved") await approveReviewRecord(admin, record, user.id, notes);
        else await rejectReviewRecord(admin, record, user.id, notes);
      } else await reviewMyDancrTvVideo(admin, user.id, id, decision as "approved" | "rejected", notes, version);
      // Publication succeeded. Activation is recoverable from the dancer dashboard if this step fails.
      if (decision === "approved") {
        try { await finalizePendingDancerNfcEnrollment(admin, { dancerUserId }); }
        catch (error) { console.warn("MEDIA_REVIEW_ACTIVATION_DEFERRED", safeErrorMetadata(error)); }
      }
      try {
        await recordVenueActivity(admin, { venueId: access.venueId, actorUserId: user.id, actorRole: access.role,
          action: `media.${decision}`, targetType: photo ? "image_moderation_record" : "mydancr_tv_video", targetId: id,
          summary: `${photo ? "Photo" : "Video"} ${decision} by the club.` });
      } catch (error) { console.warn("MEDIA_REVIEW_ACTIVITY_NOT_SAVED", safeErrorMetadata(error)); }
      return json({ ok: true, session });
    }, 270000);
  } catch (error) { return apiError(error, "Unable to save the media review. Refresh the queue before trying again."); }
}
