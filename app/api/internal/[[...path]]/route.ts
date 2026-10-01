import { after, NextResponse } from "next/server";
import { cancelInternalRequest } from "@/src/lib/dancr/internal-request-cancel";
import { deliverInternalCancellationPush } from "@/src/lib/dancr/internal-request-cancellation-push";
import { deliverInternalRequestPush } from "@/src/lib/dancr/internal-request-push";
import { internalMainPhotos } from "@/src/lib/dancr/internal-main-photo";
import { serveInternalMedia } from "@/src/lib/dancr/internal-media-delivery";
import { internalRequestsTonight, internalTableRequestStates } from "@/src/lib/dancr/internal-request-activity";
import { createHash } from "node:crypto";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { resolveApiError, PublicApiError } from "@/src/lib/api-error-policy";
import { INTERNAL_HEADERS, internalError, internalMembers, internalScope, isInternalUuid, venueRosterMembers } from "@/src/lib/dancr/internal-roster";
import { safeSocialProfileUrl } from "@/src/lib/dancr/social-profile-url";
import { MYDANCR_TV_POSTER_BUCKET, myDancrTvPosterStoragePath } from "@/src/lib/dancr/media-watermark";
import { responsiveImageStoragePaths } from "@/src/lib/dancr/responsive-image";
import type { SocialPlatform } from "@/src/lib/dancr/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path?: string[] }> };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: INTERNAL_HEADERS });

function videoPosterStoragePath(video: { storage_path: string; moderation_details?: unknown }) {
  try {
    const expected = myDancrTvPosterStoragePath(video.storage_path);
    const details = video.moderation_details;
    return details && typeof details === "object" && "posterStoragePath" in details
      && details.posterStoragePath === expected ? expected : null;
  } catch { return null; }
}

export async function GET(request: Request, context: Context) {
  try {
    const { path = [] } = await context.params;
    const url = new URL(request.url);
    const admin = createAdminSupabaseClient();
    const token = path[0] === "link" ? path[1] : url.searchParams.get("token") ?? undefined;
    if (path.length > 2 || ![undefined, "link", "requests", "avatar", "profile", "photo", "video", "video-poster"].includes(path[0]) || (path[0] === "link" && !token)
      || (path[0] === "requests" && (path.length !== 1 || token !== undefined))) return json({ ok: false, error: "Not found." }, 404);
    const scope = await internalScope(admin, request, token);
    if (path[0] === "requests") {
      const [result, members] = await Promise.all([
        admin.from("internal_roster_requests").select("id,link_id,dancer_id,status,created_at").eq("venue_id", scope.venueId)
          .in("status", ["pending", "acknowledged"]).gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString()).order("created_at").limit(200),
        internalMembers(admin, scope.venueId),
      ]);
      if (result.error) throw result.error;
      return json({ ok: true, requests: (result.data || []).filter(item => members.some(member => member.id === item.dancer_id)), session: scope.session });
    }
    // Staff see their approved affiliated dancers; table links remain internal-shift-only.
    const members = scope.link ? await internalMembers(admin, scope.venueId) : await venueRosterMembers(admin, scope.venueId);
    if (path[0] === "profile") {
      if (!members.some(member => member.id === path[1])) return json({ ok: false, error: "This profile is no longer on the club roster." }, 404);
      const results = await Promise.all([
        admin.from("dancer_profiles").select("id,slug,stage_name,city").eq("id", path[1]).single(),
        admin.from("dancer_photos").select("id,is_primary,is_pinned,sort_order,like_count").eq("dancer_id", path[1]).eq("review_status", "approved").order("is_pinned", { ascending: false }).order("is_primary", { ascending: false }).order("sort_order").limit(50),
        admin.from("social_links").select("platform,handle,url").eq("dancer_id", path[1]).eq("is_active", true),
        admin.from("mydancr_tv_videos").select("id,caption,duration_seconds,like_count,is_pinned,published_at,storage_path,moderation_details").eq("dancer_id", path[1]).eq("status", "approved").lte("published_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("published_at", { ascending: false }).limit(12),
      ]);
      for (const result of results) if (result.error) throw result.error;
      const socials = (results[2].data || []).flatMap(link => {
        const url = safeSocialProfileUrl(link.platform as SocialPlatform, link.url);
        return url ? [{ platform: link.platform, handle: link.handle, url }] : [];
      });
      const avatarRevision = createHash("sha256").update(members.find(member => member.id === path[1])!.avatar_storage_path).digest("hex").slice(0, 16);
      const [requestsTonight, tableRequests] = await Promise.all([
        internalRequestsTonight(admin, scope.venueId, path[1]),
        scope.link ? internalTableRequestStates(admin, scope.venueId, scope.link.id) : null,
      ]);
      const videos = (results[3].data || []).map(({ storage_path, moderation_details, ...video }) => ({
        ...video, has_poster: Boolean(videoPosterStoragePath({ storage_path, moderation_details })),
      }));
      return json({ ok: true, profile: { ...results[0].data, avatarRevision, workingUntil: members.find(member => member.id === path[1])?.working_until, venueName: scope.venueName, requestsTonight, requestStatus: tableRequests?.get(path[1])?.status || null, requestId: tableRequests?.get(path[1])?.id || null, photos: results[1].data || [], socialLinks: socials, videos }, session: scope.session });
    }
    if (["avatar", "photo", "video", "video-poster"].includes(path[0])) {
      const width = url.searchParams.has("width") ? Number(url.searchParams.get("width")) : null;
      if (width !== null && (![320, 480, 640, 1280].includes(width) || !["avatar", "photo"].includes(path[0]))) return json({ ok: false, error: "Invalid image size." }, 400);
      let storagePath = members.find(item => item.id === path[1])?.avatar_storage_path;
      const poster = path[0] === "video-poster";
      const video = path[0] === "video" || poster;
      if (path[0] !== "avatar") {
        if (!isInternalUuid(path[1])) return json({ ok: false, error: "Media unavailable." }, 404);
        let query = video
          ? admin.from("mydancr_tv_videos").select("dancer_id,storage_path,moderation_details")
          : admin.from("dancer_photos").select("dancer_id,storage_path");
        query = query.eq("id", path[1]).eq(video ? "status" : "review_status", "approved");
        if (video) query = query.lte("published_at", new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        storagePath = data && members.some(member => member.id === data.dancer_id)
          ? poster ? videoPosterStoragePath(data) : data.storage_path : null;
      }
      if (!storagePath) return json({ ok: false, error: "Media unavailable." }, 404);
      // Select only a pre-generated, watermarked variant of the authorized photo.
      // Full-profile media without a requested width keeps its original source.
      const imagePath = width === null ? storagePath : responsiveImageStoragePaths(storagePath)
        .slice(1).find(candidate => Number(candidate.match(/\.w(\d+)\.webp$/)?.[1]) >= width) || storagePath;
      const bucket = poster ? MYDANCR_TV_POSTER_BUCKET : video ? "mydancr-tv-videos" : "dancer-photos";
      return serveInternalMedia(request, {
        kind: video && !poster ? "video" : "image", path: imagePath, fallbackPath: storagePath,
        sign: async (objectPath) => {
          const { data, error } = await admin.storage.from(bucket).createSignedUrl(objectPath, 30);
          return error ? null : data?.signedUrl || null;
        },
      });
    }
    const mainPhotos = await internalMainPhotos(admin, members.map(item => item.id));
    const dancers = members.map(item => {
      const photo = mainPhotos.get(item.id);
      return {
        id: item.id, stageName: item.stage_name, workingUntil: item.working_until,
        avatarRevision: createHash("sha256").update(item.avatar_storage_path).digest("hex").slice(0, 16),
        mainPhotoId: photo?.id || null,
        mainPhotoRevision: photo ? createHash("sha256").update(photo.storage_path).digest("hex").slice(0, 16) : "",
      };
    });
    if (scope.link) {
      const tableRequests = await internalTableRequestStates(admin, scope.venueId, scope.link.id);
      let receipt = null;
      const key = url.searchParams.get("requestKey");
      if (key && isInternalUuid(key) && scope.link.kind === "table") {
        const { data, error } = await admin.from("internal_roster_requests").select("status,dancer_id,created_at").eq("link_id", scope.link.id).eq("request_key", key).maybeSingle();
        if (error) throw error;
        if (data) receipt = { status: Date.parse(data.created_at) > Date.now() - 6 * 3600000 && members.some(d => d.id === data.dancer_id) ? data.status : "cancelled" };
      }
      return json({ ok: true, venueName: scope.venueName, venueLogoUrl: scope.venueLogoUrl, kind: scope.link.kind, label: scope.link.label, dancers: dancers.map(dancer => ({ ...dancer, requestStatus: tableRequests.get(dancer.id)?.status || null, requestId: tableRequests.get(dancer.id)?.id || null })), receipt });
    }
    const results = await Promise.all([
      admin.from("internal_roster_links").select("id,kind,label,token,active").eq("venue_id", scope.venueId).eq("active", true).eq("kind", "table").order("created_at"),
      admin.from("internal_roster_requests").select("id,link_id,dancer_id,status,created_at").eq("venue_id", scope.venueId).in("status", ["pending", "acknowledged"]).gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString()).order("created_at").limit(200),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const links = results[0].data || [];
    const internal = await internalMembers(admin, scope.venueId);
    const requests = (results[1].data || []).filter(item => internal.some(d => d.id === item.dancer_id));
    return json({ ok: true, venueName: scope.venueName, dancers, links, requests, role: scope.role, session: scope.session });
  } catch (error) {
    const resolved = resolveApiError(internalError(error), "Unable to load the club roster.");
    return json(resolved.body, resolved.status);
  }
}

export async function POST(request: Request, context: Context) {
  const deliveryDeadline = performance.now() + 50_000;
  try {
    const { path = [] } = await context.params;
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid roster request.", tooLargeMessage: "Roster request is too large." });
    const admin = createAdminSupabaseClient();
    if (path.length === 2 && path[0] === "link") {
      const scope = await internalScope(admin, request, path[1]);
      if (body.action === "cancel_request") {
        if (!scope.link || !isInternalUuid(body.dancerId) || !isInternalUuid(body.requestId)) throw new PublicApiError("INVALID_REQUEST", "Choose the request to cancel.", 400);
        const receipt = await cancelInternalRequest(admin, scope.venueId, scope.link.id, body.dancerId, body.requestId);
        after(async () => {
          try { await deliverInternalCancellationPush(createAdminSupabaseClient(), receipt.id, { deadline: deliveryDeadline }); }
          catch { console.warn("INTERNAL_REQUEST_CANCELLATION_ALERT_FAILED"); }
        });
        return json({ ok: true, receipt });
      }
      if (body.action !== undefined) throw new PublicApiError("INVALID_REQUEST", "Invalid table action.", 400);
      if (scope.link?.kind !== "table" || !isInternalUuid(body.dancerId) || !isInternalUuid(body.requestKey)) throw new PublicApiError("INVALID_REQUEST", "Choose an available dancer before sending a request.", 400);
      const { data, error } = await admin.rpc("internal_roster_request", { p_token: path[1], p_dancer: body.dancerId, p_key: body.requestKey });
      if (error) throw error;
      if (isInternalUuid(data?.id)) after(async () => {
        try { await deliverInternalRequestPush(createAdminSupabaseClient(), data.id, { deadline: deliveryDeadline }); }
        catch { console.warn("INTERNAL_REQUEST_PUSH_DEFERRED_TO_WORKER"); }
      });
      return json({ ok: true, receipt: data });
    }
    if (path.length) return json({ ok: false, error: "Not found." }, 404);
    const scope = await internalScope(admin, request);
    const { data, error } = await admin.rpc("internal_roster_manage", { p_actor: scope.userId, p_venue: scope.venueId, p_action: body.action, p_data: body });
    if (error) throw error;
    return json({ ok: true, result: data, session: scope.session });
  } catch (error) {
    const resolved = resolveApiError(internalError(error), "Unable to update the club roster.");
    return json(resolved.body, resolved.status);
  }
}
