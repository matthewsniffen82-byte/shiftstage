import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import {
  createMyDancrTvUpload,
  hideOwnMyDancrTvVideo,
  MYDANCR_TV_BUCKET,
  MYDANCR_TV_MAX_BYTES,
  MYDANCR_TV_MAX_DURATION_SECONDS,
  MYDANCR_TV_MIME_TYPES,
  MYDANCR_TV_PROFILE_SLOT_STATUSES,
  MYDANCR_TV_PROFILE_VIDEO_LIMIT,
  publishPlatformMyDancrTvUpload,
  retryMyDancrTvAutomatedModeration,
  reviewMyDancrTvVideo,
  submitMyDancrTvUpload,
} from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMPORT_BODY_BYTES = 32_768;

type ImportVideoInput = {
  fileSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  mimeType: string;
  distributionScope: "profile_and_feed" | "feed_only";
};

type PreparedUpload = {
  videoId: string;
  path: string;
  token: string;
  uploadUrl: string;
};

export async function POST(request: Request) {
  try {
    authorizeImportRequest(request);
    const body = await readImportBody(request);
    const action = body?.action;
    if (action === "prepare") return prepareImport(body);
    if (action === "finalize") return finalizeImport(body);
    return NextResponse.json({ ok: false, error: "Choose a supported import action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to import MyDancr TV media.");
  }
}

async function prepareImport(body: any) {
  const dancerSlug = cleanSlug(body?.dancerSlug);
  const batchId = cleanBatchId(body?.batchId);
  const videos = parseVideos(body?.videos);
  const replaceExisting = body?.replaceExisting === true;
  const admin = createAdminSupabaseClient();

  const { data: dancer, error: dancerError } = await admin
    .from("dancer_profiles")
    .select("id, user_id, stage_name, slug")
    .eq("slug", dancerSlug)
    .maybeSingle();
  if (dancerError) throw dancerError;
  if (!dancer?.user_id) throw invalid("The requested dancer profile is unavailable.");

  const markerPrefix = importMarker(batchId);
  const { count: existingBatchCount, error: batchError } = await admin
    .from("mydancr_tv_videos")
    .select("id", { count: "exact", head: true })
    .eq("dancer_id", dancer.id)
    .like("review_notes", `${markerPrefix}%`);
  if (batchError) throw batchError;
  if (Number(existingBatchCount || 0) > 0) {
    throw invalid("This import batch has already been prepared.", 409);
  }

  const { data: activeVideos, error: activeError } = await admin
    .from("mydancr_tv_videos")
    .select("id")
    .eq("dancer_id", dancer.id)
    .eq("distribution_scope", "profile_and_feed")
    .in("status", [...MYDANCR_TV_PROFILE_SLOT_STATUSES]);
  if (activeError) throw activeError;
  const activeCount = activeVideos?.length || 0;
  const requestedProfileVideoCount = videos.filter(
    (video) => video.distributionScope === "profile_and_feed",
  ).length;
  if (!replaceExisting && activeCount + requestedProfileVideoCount > MYDANCR_TV_PROFILE_VIDEO_LIMIT) {
    throw invalid(`This profile has ${activeCount} occupied video slots; replace existing videos or reduce this batch.`, 409);
  }

  if (replaceExisting) {
    for (const video of activeVideos || []) {
      await hideOwnMyDancrTvVideo(admin, dancer.user_id, video.id);
    }
  }

  const prepared: PreparedUpload[] = [];
  try {
    for (let index = 0; index < videos.length; index += 1) {
      const video = videos[index];
      const upload = await createMyDancrTvUpload(admin, dancer.user_id, {
        fileSize: video.fileSize,
        durationSeconds: video.durationSeconds,
        width: video.width,
        height: video.height,
        mimeType: video.mimeType,
        consentConfirmed: true,
        rightsConfirmed: true,
        distributionScope: video.distributionScope,
      });
      const { error: markerError } = await admin
        .from("mydancr_tv_videos")
        .update({
          review_notes: `${markerPrefix}${index + 1}`,
        })
        .eq("id", upload.videoId)
        .eq("submitted_by", dancer.user_id);
      if (markerError) throw markerError;
      prepared.push(upload);
    }
  } catch (error) {
    await cleanupPreparedUploads(admin, prepared);
    throw error;
  }

  console.info(JSON.stringify({
    event: "mydancr_tv.platform_import_prepared",
    batchId,
    dancerId: dancer.id,
    replacedCount: replaceExisting ? activeCount : 0,
    videoCount: prepared.length,
  }));

  return NextResponse.json({
    ok: true,
    batchId,
    dancer: { id: dancer.id, slug: dancer.slug, stageName: dancer.stage_name },
    replacedCount: replaceExisting ? activeCount : 0,
    uploads: prepared,
    publicSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publicSupabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function finalizeImport(body: any) {
  const batchId = cleanBatchId(body?.batchId);
  const videoId = cleanUuid(body?.videoId);
  const recoverPreparedVideo = body?.recoverPreparedVideo === true;
  const admin = createAdminSupabaseClient();
  const markerPrefix = importMarker(batchId);
  const { data: row, error: rowError } = await admin
    .from("mydancr_tv_videos")
    .select("id, submitted_by, review_notes, status")
    .eq("id", videoId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row || (!String(row.review_notes || "").startsWith(markerPrefix) && !recoverPreparedVideo)) {
    throw invalid("The requested import video does not belong to this batch.");
  }

  let result: any = row;
  if (row.status === "uploading") {
    const adminId = await activeAdminUserId(admin);
    result = await publishPlatformMyDancrTvUpload(admin, adminId, row.id);
  } else if (row.status === "moderating") {
    result = await retryMyDancrTvAutomatedModeration(admin, row.id);
  }

  if (result?.status === "submitted" || row.status === "submitted") {
    const adminId = await activeAdminUserId(admin);
    result = await reviewMyDancrTvVideo(
      admin,
      adminId,
      row.id,
      "approved",
      "Approved for publication by the platform media owner.",
    );
  }

  const { data: finalized, error: finalizedError } = await admin
    .from("mydancr_tv_videos")
    .select("status, review_notes")
    .eq("id", row.id)
    .single();
  if (finalizedError) throw finalizedError;
  const moderationNote = String(finalized.review_notes || "").trim();
  const privateReviewNote = `${markerPrefix}${finalized.status}${moderationNote ? `\n${moderationNote}` : ""}`;
  const { error: noteError } = await admin
    .from("mydancr_tv_videos")
    .update({ review_notes: privateReviewNote })
    .eq("id", row.id);
  if (noteError) throw noteError;

  console.info(JSON.stringify({
    event: "mydancr_tv.platform_import_finalized",
    batchId,
    videoId: row.id,
    status: result?.status || row.status,
  }));
  return NextResponse.json({ ok: true, batchId, video: result }, {
    headers: { "Cache-Control": "no-store" },
  });
}

function parseVideos(value: unknown): ImportVideoInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLATFORM_IMPORT_BATCH_LIMIT) {
    throw invalid(`Choose between 1 and ${PLATFORM_IMPORT_BATCH_LIMIT} videos.`);
  }
  return value.map((raw: any) => {
    const video = {
      fileSize: Number(raw?.fileSize),
      durationSeconds: Number(raw?.durationSeconds),
      width: Number(raw?.width),
      height: Number(raw?.height),
      mimeType: typeof raw?.mimeType === "string" ? raw.mimeType.trim() : "",
      distributionScope: raw?.distributionScope === "feed_only" ? "feed_only" as const : "profile_and_feed" as const,
    };
    if (!MYDANCR_TV_MIME_TYPES.has(video.mimeType)) throw invalid("Upload an MP4 or WebM video.");
    if (!Number.isSafeInteger(video.fileSize) || video.fileSize < 1 || video.fileSize > MYDANCR_TV_MAX_BYTES) {
      throw invalid("Video files must be 75 MB or smaller.");
    }
    if (!Number.isFinite(video.durationSeconds) || video.durationSeconds < 1 || video.durationSeconds > MYDANCR_TV_MAX_DURATION_SECONDS) {
      throw invalid("Videos must be between 1 and 30 seconds.");
    }
    if (!Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) || video.width < 240 || video.height < video.width || video.height > 7680) {
      throw invalid("Upload a vertical or square video at least 240 pixels wide.");
    }
    return video;
  });
}

async function cleanupPreparedUploads(admin: ReturnType<typeof createAdminSupabaseClient>, prepared: PreparedUpload[]) {
  if (!prepared.length) return;
  const paths = prepared.map((upload) => upload.path);
  const ids = prepared.map((upload) => upload.videoId);
  await admin.storage.from(MYDANCR_TV_BUCKET).remove(paths).catch(() => null);
  await admin.from("mydancr_tv_videos").delete().in("id", ids);
}

async function activeAdminUserId(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data, error } = await admin
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .eq("account_state", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw forbidden("An active administrator is required to approve this video.");
  return data.id;
}

function authorizeImportRequest(request: Request) {
  const expected = process.env.DANCR_MEDIA_IMPORT_KEY || "";
  const provided = request.headers.get("x-mydancr-media-import-key") || "";
  if (expected.length < 32 || provided.length !== expected.length) throw forbidden("Media import access denied.");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw forbidden("Media import access denied.");
  }
}

function cleanBatchId(value: unknown) {
  const batchId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(batchId)) throw invalid("Use a valid import batch ID.");
  return batchId;
}

function cleanSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9-]{1,119}$/.test(slug)) throw invalid("Use a valid dancer profile slug.");
  return slug;
}

function cleanUuid(value: unknown) {
  const uuid = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(uuid)) throw invalid("Use a valid video ID.");
  return uuid;
}

function importMarker(batchId: string) {
  return `platform-import:${batchId}:`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORM_IMPORT_BATCH_LIMIT = 30;

async function readImportBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BODY_BYTES) {
    throw invalid("Import request is too large.", 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BODY_BYTES) throw invalid("Import request is too large.", 413);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalid("Invalid import request.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw invalid("Invalid import request.");
  }
}

function invalid(message: string, status = 400) {
  return new PublicApiError(status === 409 ? "CONFLICT" : "INVALID_REQUEST", message, status);
}

function forbidden(message: string) {
  return new PublicApiError("FORBIDDEN", message, 403);
}
