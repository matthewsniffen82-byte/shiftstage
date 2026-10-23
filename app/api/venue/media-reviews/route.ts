import { after, NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { runWithServerJob } from "@/src/lib/server-job";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { rejectReviewRecord, withSignedThumbnail } from "@/src/lib/dancr/image-review";
import { MYDANCR_TV_BUCKET, reviewMyDancrTvVideo } from "@/src/lib/dancr/tv";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { isBriefRejectionReason } from "@/src/lib/dancr/media-review-label";
import { profilePhotoSlotFromUploadContext } from "@/src/lib/dancr/photo-slot";

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

async function mainPhotoPreviews(admin: any, dancerIds: string[]) {
  const previews = new Map<string, string>();
  if (!dancerIds.length) return previews;
  // IDs come only from the venue-authorized grid RPC, never request input.
  const { data: profiles, error: profileError } = await admin.from("dancer_profiles")
    .select("id, user_id, dancer_photos(id, storage_path)")
    .in("id", dancerIds)
    .eq("dancer_photos.is_primary", true)
    .eq("dancer_photos.review_status", "approved");
  if (profileError) throw profileError;
  if (!profiles?.length) return previews;
  const { data: pending, error: pendingError } = await admin.from("image_moderation_records")
    .select("id, user_id, image_id, upload_context, decision, status, temporary_storage_path, final_storage_path")
    .in("user_id", profiles.map((profile: any) => profile.user_id))
    .like("upload_context", "profile_main%")
    .eq("decision", "review").eq("status", "pending_review")
    .eq("category_flags->>file_checks_passed", "true")
    .not("temporary_storage_path", "is", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (pendingError) throw pendingError;
  await Promise.all(profiles.map(async (profile: any) => {
    const approved = profile.dancer_photos?.[0];
    const replacement = (pending || []).find((record: any) => record.user_id === profile.user_id
      && profilePhotoSlotFromUploadContext(record.upload_context).isPrimary
      && !(approved && (record.image_id === approved.id || record.final_storage_path === approved.storage_path)));
    let url = replacement ? (await withSignedThumbnail(admin, replacement)).thumbnailUrl : "";
    if (!url && approved?.storage_path) {
      url = (await withSignedThumbnail(admin, { decision: "approved", final_storage_path: approved.storage_path })).thumbnailUrl;
    }
    previews.set(profile.id, url);
  }));
  return previews;
}

export async function GET(request: Request) {
  try {
    const { admin, access, user, session } = await context(request);
    const url = new URL(request.url);
    const offset = Math.max(0, Math.min(100000, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0));
    const dancerId = url.searchParams.get("dancerId");
    if (dancerId !== null && !uuid.test(dancerId)) throw new PublicApiError("INVALID_REQUEST", "Choose a dancer to review.", 400);
    const grouped = url.searchParams.get("view") === "dancers" || dancerId !== null;
    const { data, error } = await admin.rpc(grouped ? "get_venue_dancer_media_grid" : "get_venue_dancer_media_review", {
      p_actor_id: user.id, p_venue_id: access.venueId, p_offset: offset, p_limit: url.searchParams.get("countOnly") === "1" ? 0 : 12,
      ...(grouped ? { p_dancer_id: dancerId } : {}),
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
      const ready = photo ? r.category_flags?.file_checks_passed === true : r.moderation_details?.fileChecksPassed === true;
      return { id: item.id, kind: item.kind, dancerId: item.dancerId, stageName: item.stageName, version: r.updated_at, previewUrl, caption: photo ? null : r.caption,
        label: photo ? r.upload_context === "profile_avatar" ? "Avatar" : r.upload_context.startsWith("profile_main") ? "Main photo/avatar" : "Photo" : "Video",
        processing, canApprove: !processing && ready && !r.club_reviewed_at && (photo || !r.upload_validation_pending),
        reviewSummary: processing ? "Preparing upload" : "Club review required before MyDancr final approval",
        reasons: photo ? r.reason_codes || [] : r.moderation_reason_codes || [],
      };
    }));
    const gridDancers = data?.dancers || [];
    const previews = await mainPhotoPreviews(admin, gridDancers.map((dancer: any) => dancer.id));
    const dancers = gridDancers.map((dancer: any) => ({ id: dancer.id, stageName: dancer.stageName, count: dancer.count,
      photoCount: dancer.photoCount, videoCount: dancer.videoCount, previewUrl: previews.get(dancer.id) || "" }));
    return json({ ok: true, venueId: access.venueId, count: data?.count || 0, items, session,
      ...(grouped ? { dancers, dancer: data?.dancer || null, dancerCount: data?.dancerCount || 0, uploadCount: data?.uploadCount || 0 } : {}),
    });
  } catch (error) { return apiError(error, "Unable to load your club’s media reviews."); }
}

export async function POST(request: Request) {
  const followUps: Array<() => Promise<void>> = [];
  try {
    const response = await runWithServerJob(async () => {
      const { admin, access, user, session } = await context(request);
      const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid media review.", tooLargeMessage: "Review notes are too long." });
      const { id, kind, decision, version } = body;
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (typeof id !== "string" || !uuid.test(id) || !["photo", "video"].includes(String(kind)) || !["approved", "rejected"].includes(String(decision))
        || typeof version !== "string" || !Number.isFinite(Date.parse(version)) || notes.length > 4000) {
        throw new PublicApiError("INVALID_REQUEST", "Choose an upload and a review decision.", 400);
      }
      const photo = kind === "photo";
      if (decision === "rejected" && !photo && !isBriefRejectionReason(notes)) throw new PublicApiError("INVALID_REQUEST", "Enter a rejection reason in 1–3 words.", 400);
      const { data: record, error } = await admin.from(photo ? "image_moderation_records" : "mydancr_tv_videos").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!record || (photo && !String(record.upload_context).startsWith("profile_"))) throw new PublicApiError("NOT_FOUND", "Upload not found.", 404);
      const dancerUserId = photo ? record.user_id : record.submitted_by;
      const authorization = await admin.rpc("assert_dancer_media_reviewer", { p_actor_id: user.id, p_dancer_user_id: dancerUserId, p_venue_id: access.venueId });
      if (authorization.error) throw new PublicApiError("FORBIDDEN", "This dancer is not connected to your club. Refresh the queue.", 403);
      if (record.updated_at !== version) throw new PublicApiError("CONFLICT", "This upload changed. Refresh before reviewing it.", 409);
      if (record.club_reviewed_at) throw new PublicApiError("CONFLICT", "This upload is already waiting for MyDancr approval.", 409);
      if (decision === "approved") {
        const { data: signedOff, error: signoffError } = await admin.rpc("review_club_dancer_media", {
          p_actor_id: user.id, p_venue_id: access.venueId, p_kind: kind, p_id: id,
          p_expected_updated_at: version, p_notes: notes,
        });
        if (signoffError) throw new PublicApiError("CONFLICT", "The upload changed or is still processing. Refresh the queue.", 409);
        if (signedOff?.id !== id || signedOff?.club_reviewed_by !== user.id || !signedOff.club_reviewed_at) {
          throw new Error("Club review could not be confirmed. Refresh the queue.");
        }
      } else if (photo) await rejectReviewRecord(admin, record, user.id, notes || "Not approved");
      else await reviewMyDancrTvVideo(admin, user.id, id, "rejected", notes, version);
      followUps.push(async () => {
        await recordVenueActivity(admin, { venueId: access.venueId, actorUserId: user.id, actorRole: access.role,
          action: `media.${decision}`, targetType: photo ? "image_moderation_record" : "mydancr_tv_video", targetId: id,
          summary: `${photo ? "Photo" : "Video"} ${decision} by the club.` });
      });
      return json({ ok: true, message: decision === "approved" ? "Sent to MyDancr for final approval. Still private." : "Upload rejected.", session });
    }, 270000);
    // Register outside the completed job's cancellation scope. Next keeps this
    // bounded work alive after returning the confirmed result to the dashboard.
    after(async () => {
      await Promise.all(followUps.map(async work => {
        try { await runWithServerJob(work); }
        catch (error) { console.warn("MEDIA_REVIEW_FOLLOW_UP_DEFERRED", safeErrorMetadata(error)); }
      }));
    });
    return response;
  } catch (error) { return apiError(error, "Unable to save the media review. Refresh the queue before trying again."); }
}
