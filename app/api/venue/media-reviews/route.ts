import { after, NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { runWithServerJob } from "@/src/lib/server-job";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { withSignedThumbnail } from "@/src/lib/dancr/image-review";
import { MYDANCR_TV_BUCKET, normalizedVideoPosterStoragePath } from "@/src/lib/dancr/tv";
import { MYDANCR_TV_POSTER_BUCKET } from "@/src/lib/dancr/media-watermark";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { isBriefRejectionReason } from "@/src/lib/dancr/media-review-label";
import { mainPhotoPreviews } from "@/src/lib/dancr/media-review-main-photo";
import { venueMediaAvatar } from "@/src/lib/dancr/venue-media-avatar";

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
    const dancerId = url.searchParams.get("dancerId");
    if (dancerId !== null && !uuid.test(dancerId)) throw new PublicApiError("INVALID_REQUEST", "Choose a dancer to review.", 400);
    const grouped = url.searchParams.get("view") === "dancers" || dancerId !== null;
    const { data, error } = await admin.rpc("get_club_media_queue", {
      p_actor_id: user.id, p_venue_id: access.venueId, p_offset: offset, p_limit: url.searchParams.get("countOnly") === "1" ? 0 : 12,
      p_dancer_id: dancerId, p_status: url.searchParams.get("status") === "all" ? "all" : "pending",
    });
    if (error) throw error;
    let pendingMediaCount = dancerId ? data?.uploadCount || 0 : 0;
    if (dancerId && url.searchParams.get("status") === "all") {
      const pending = await admin.rpc("get_club_media_queue", { p_actor_id: user.id, p_venue_id: access.venueId,
        p_offset: 0, p_limit: 0, p_dancer_id: dancerId, p_status: "pending" });
      if (pending.error) throw pending.error;
      pendingMediaCount = pending.data?.uploadCount || 0;
    }
    const items = await Promise.all((data?.items || []).map(async (item: any) => {
      const r = item.record, photo = item.kind === "photo";
      const processing = photo ? ["pending", "moderating", "moderation_retry"].includes(r.status) : r.status === "moderating";
      let previewUrl = "";
      let posterUrl = "";
      if (photo) previewUrl = (await withSignedThumbnail(admin, r)).thumbnailUrl;
      else {
        const signed = await admin.storage.from(MYDANCR_TV_BUCKET).createSignedUrl(r.storage_path, 300);
        if (signed.error) throw signed.error;
        previewUrl = signed.data?.signedUrl || "";
        const posterPath = normalizedVideoPosterStoragePath(r);
        if (posterPath) {
          const poster = await admin.storage.from(MYDANCR_TV_POSTER_BUCKET).createSignedUrl(posterPath, 300);
          if (!poster.error) posterUrl = poster.data?.signedUrl || "";
        }
      }
      const ready = r.status === "approved" || (photo ? r.category_flags?.file_checks_passed === true : r.moderation_details?.fileChecksPassed === true);
      const caption = photo ? "" : String(r.caption || "").trim();
      return { id: item.id, kind: item.kind, source: item.source, dancerId: item.dancerId, stageName: item.stageName,
        contentVersion: item.contentVersion, decisionVersion: item.decisionVersion, clubStatus: item.clubStatus,
        version: r.updated_at, previewUrl, posterUrl,
        caption: caption && !uuid.test(caption.replace(/\.(?:mp4|mov|m4v|webm)$/i, "")) ? caption : null,
        label: photo ? r.upload_context === "profile_avatar" ? "Avatar" : r.upload_context.startsWith("profile_main") ? "Main photo/avatar" : "Photo" : "Video",
        processing, canApprove: !processing && ready && (photo || !r.upload_validation_pending),
        reviewSummary: r.status === "approved" ? "MyDancr approved · Your club controls display here" : "MyDancr final approval is also required before display",
        reasons: photo ? r.reason_codes || [] : r.moderation_reason_codes || [],
      };
    }));
    const gridDancers = !dancerId && url.searchParams.get("countOnly") !== "1" ? data?.dancers || [] : [];
    const previews = await mainPhotoPreviews(admin, gridDancers.map((dancer: any) => dancer.id));
    const dancers = gridDancers.map((dancer: any) => ({ id: dancer.id, stageName: dancer.stageName, count: dancer.count,
      photoCount: dancer.photoCount, videoCount: dancer.videoCount, previewUrl: previews.get(dancer.id) || "" }));
    const dancerAvatar = dancerId && data?.dancer?.id === dancerId && url.searchParams.get("countOnly") !== "1"
      ? await venueMediaAvatar(admin, data.dancer.id) : null;
    return json({ ok: true, venueId: access.venueId, count: data?.count || 0, items, session,
      ...(grouped ? { dancers, dancer: data?.dancer || null, dancerAvatar, pendingMediaCount, dancerCount: data?.dancerCount || 0, uploadCount: data?.uploadCount || 0 } : {}),
    });
  } catch (error) { return apiError(error, "Unable to load your club’s media reviews."); }
}

export async function POST(request: Request) {
  const followUps: Array<() => Promise<void>> = [];
  try {
    const response = await runWithServerJob(async () => {
      const { admin, access, user, session } = await context(request);
      const body = await readBoundedJsonObject(request, { maxBytes: 8192, invalidMessage: "Invalid media review.", tooLargeMessage: "Review notes are too long." });
      const { id, kind, decision, dancerId, source, contentVersion, decisionVersion } = body;
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (typeof id !== "string" || !uuid.test(id) || !["photo", "video"].includes(String(kind)) || !["approved", "rejected"].includes(String(decision))
        || typeof dancerId !== "string" || !uuid.test(dancerId)
        || !["upload", "photo", "avatar", "video"].includes(String(source))
        || (kind === "video") !== (source === "video")
        || typeof contentVersion !== "string" || !/^[a-f0-9]{32}$/.test(contentVersion)
        || (decisionVersion !== null && (typeof decisionVersion !== "string" || !uuid.test(decisionVersion))) || notes.length > 4000) {
        throw new PublicApiError("INVALID_REQUEST", "Choose an upload and a review decision.", 400);
      }
      const photo = kind === "photo";
      if (decision === "rejected" && !photo && !isBriefRejectionReason(notes)) throw new PublicApiError("INVALID_REQUEST", "Enter a rejection reason in 1–3 words.", 400);
      const { data: saved, error } = await admin.rpc("set_club_media_permission", {
        p_actor_id: user.id, p_venue_id: access.venueId, p_dancer_id: dancerId, p_source: source,
        p_id: id, p_content_version: contentVersion, p_decision_version: decisionVersion,
        p_decision: decision, p_notes: notes || (decision === "rejected" ? "Not approved for this club" : ""),
      });
      if (error?.code === "42501") throw new PublicApiError("FORBIDDEN", "This dancer is not connected to your club. Refresh the queue.", 403);
      if (error) throw new PublicApiError("CONFLICT", "The media or club decision changed. Refresh before reviewing it.", 409);
      if (saved?.media_id !== id || saved?.venue_id !== access.venueId || saved?.reviewer_id !== user.id || saved?.decision !== decision
        || typeof saved?.revision !== "string" || !uuid.test(saved.revision)) {
        throw new Error("Club review could not be confirmed. Refresh the queue.");
      }
      followUps.push(async () => {
        await recordVenueActivity(admin, { venueId: access.venueId, actorUserId: user.id, actorRole: access.role,
          action: `media.${decision}`, targetType: photo ? "image_moderation_record" : "mydancr_tv_video", targetId: id,
          summary: `${photo ? "Photo" : "Video"} ${decision} for this club only.` });
      });
      return json({ ok: true, review: { id, clubStatus: decision, decisionVersion: saved.revision }, message: decision === "approved"
        ? saved.platformApproved ? "Approved for your club." : "Approved for your club. Waiting for MyDancr final approval."
        : "Hidden at your club. Other clubs and the dancer’s profile are unchanged.", session });
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
