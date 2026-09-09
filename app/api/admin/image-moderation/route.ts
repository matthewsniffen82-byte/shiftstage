import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  APPROVED_PHOTO_BUCKET,
  MODERATION_REVIEW_BUCKET,
  MODERATION_TEMP_BUCKET,
  setApprovedDancerAvatar,
} from "@/src/lib/dancr/image-moderation";
import { validateAndPrepareDancrImage } from "@/src/lib/dancr/image-validation";
import { isProfileAvatarUploadContext } from "@/src/lib/dancr/photo-slot";
import { publishDancerPhoto } from "@/src/lib/dancr/photo-publication";
import {
  removeResponsiveImage,
  uploadResponsiveImage,
} from "@/src/lib/dancr/responsive-image";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_DECISIONS = new Set(["approved", "rejected"]);
const MAX_IMAGE_REVIEW_BODY_BYTES = 8_192;
const MAX_IMAGE_REVIEW_PAGE = 1_000;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const admin = createAdminSupabaseClient() as any;
    const url = new URL(request.url);
    const decision = url.searchParams.get("decision") || "review";
    const page = Math.min(
      MAX_IMAGE_REVIEW_PAGE,
      Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0),
    );
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "12", 10) || 12));

    let query = admin
      .from("image_moderation_records")
      .select("id, user_id, image_id, temporary_storage_path, final_storage_path, upload_context, provider, provider_model, provider_flagged, decision, status, reason_codes, category_flags, category_scores, reviewed_by, reviewed_at, review_decision, review_notes, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (["review", "approved", "rejected"].includes(decision)) query = query.eq("decision", decision);

    const { data, error, count } = await query;
    if (error) throw error;

    const records = await Promise.all((data || []).map((record: any) => withSignedThumbnail(admin, record)));
    return NextResponse.json({ ok: true, records, count: count || 0, page, pageSize, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load image moderation queue.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const admin = createAdminSupabaseClient() as any;
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_IMAGE_REVIEW_BODY_BYTES,
      invalidMessage: "Invalid image moderation request.",
      tooLargeMessage: "Image moderation request is too large.",
    });
    const recordId = typeof body?.recordId === "string" ? body.recordId.trim() : "";
    const decision = typeof body?.decision === "string" ? body.decision.trim() : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

    if (!recordId) return NextResponse.json({ ok: false, error: "Missing moderation record." }, { status: 400 });
    if (!REVIEW_DECISIONS.has(decision)) return NextResponse.json({ ok: false, error: "Decision must be approved or rejected." }, { status: 400 });

    const { data: record, error } = await admin
      .from("image_moderation_records")
      .select("*")
      .eq("id", recordId)
      .maybeSingle();
    if (error) throw error;
    if (!record) return NextResponse.json({ ok: false, error: "Moderation record not found." }, { status: 404 });

    if (decision === "approved") {
      const approved = await approveReviewRecord(admin, record, user.id, notes);
      return NextResponse.json({ ok: true, record: approved, session: session || null });
    }

    const rejected = await rejectReviewRecord(admin, record, user.id, notes);
    return NextResponse.json({ ok: true, record: rejected, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to update image moderation record.");
  }
}

async function withSignedThumbnail(admin: any, record: any) {
  const bucket = moderationStorageBucket(record);
  const path = record.decision === "approved" ? record.final_storage_path : record.temporary_storage_path;
  let thumbnailUrl = "";
  if (path) {
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, 300);
    thumbnailUrl = data?.signedUrl || "";
  }
  return {
    ...record,
    thumbnailUrl,
    categoryScores: record.category_scores || {},
    categoryFlags: record.category_flags || {},
    reasonCodes: record.reason_codes || [],
  };
}

async function approveReviewRecord(admin: any, record: any, reviewerId: string, notes: string) {
  const isAvatar = isProfileAvatarUploadContext(record.upload_context);
  if (!isAvatar && record.decision === "approved") {
    return (await publishDancerPhoto(admin, {
      recordId: record.id, expectedUpdatedAt: record.updated_at, storagePath: record.final_storage_path, reviewerId, notes,
    })).record;
  }
  const profile = await profileForModerationRecord(admin, record);
  const sourcePath = record.temporary_storage_path;
  if (!sourcePath) throw new Error("Review image is missing.");
  const sourceBucket = moderationStorageBucket(record);
  const { data: file, error: downloadError } = await admin.storage.from(sourceBucket).download(sourcePath);
  if (downloadError || !file) throw downloadError || new Error("Unable to read review image.");

  const image = await validateAndPrepareDancrImage(file);
  const uploadedImage = await uploadResponsiveImage(
    admin,
    APPROVED_PHOTO_BUCKET,
    isAvatar
      ? `${record.user_id}/${profile.id}/avatar`
      : `${record.user_id}/${profile.id}`,
    image,
    "31536000",
    isAvatar
      ? {}
      : { archiveOriginal: true, watermark: true },
  );
  const finalPath = uploadedImage.storagePath;
  let previousAvatarPath: string | null = null;

  try {
    if (isAvatar) {
      previousAvatarPath = await setApprovedDancerAvatar(admin, profile.id, finalPath);
      const update = {
        image_id: null,
        final_storage_path: finalPath,
        decision: "approved",
        status: "approved",
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        review_decision: "approved",
        review_notes: notes || null,
        updated_at: new Date().toISOString(),
      };
      const { data: updated, error: updateError } = await admin
        .from("image_moderation_records")
        .update(update)
        .eq("id", record.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      await admin.storage.from(sourceBucket).remove([sourcePath]).catch(() => null);
      if (previousAvatarPath && previousAvatarPath !== finalPath) {
        await removeResponsiveImage(admin, APPROVED_PHOTO_BUCKET, previousAvatarPath).catch(() => null);
      }
      console.info(JSON.stringify({ event: "image_moderation.admin_decision", recordId: record.id, decision: "approved", target: "avatar" }));
      return updated;
    }

    const { record: updated } = await publishDancerPhoto(admin, {
      recordId: record.id, expectedUpdatedAt: record.updated_at, storagePath: finalPath, reviewerId, notes,
      metadata: { reasonCodes: record.reason_codes, categoryFlags: record.category_flags,
        categoryScores: record.category_scores, providerFlagged: record.provider_flagged },
    });
    await admin.storage.from(sourceBucket).remove([sourcePath]).catch(() => null);
    console.info(JSON.stringify({ event: "image_moderation.admin_decision", recordId: record.id, decision: "approved" }));
    return updated;
  } catch (error) {
    // An unconfirmed write may already reference finalPath. Retain approved
    // files and current references instead of destructive compensation.
    console.warn("IMAGE_MODERATION_PUBLICATION_UNCONFIRMED", {
      recordId: record.id,
      ...safeErrorMetadata(error),
    });
    throw error;
  }
}

async function rejectReviewRecord(admin: any, record: any, reviewerId: string, notes: string) {
  const sourcePath = record.temporary_storage_path;
  const update = {
    decision: "rejected",
    status: "rejected",
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
    review_decision: "rejected",
    review_notes: notes || "Rejected by admin moderation.",
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = await admin.from("image_moderation_records").update(update)
    .eq("id", record.id).eq("decision", "review").eq("updated_at", record.updated_at).select("*").maybeSingle();
  if (error) throw error;
  if (!updated) throw new PublicApiError("CONFLICT", "This upload already changed. Refresh the review queue.", 409);
  if (sourcePath) {
    await admin.storage.from(MODERATION_REVIEW_BUCKET).remove([sourcePath]).catch(() => null);
    await admin.storage.from(MODERATION_TEMP_BUCKET).remove([sourcePath]).catch(() => null);
  }
  await createNeutralNotification(admin, record.user_id);
  console.info(JSON.stringify({ event: "image_moderation.admin_decision", recordId: record.id, decision: "rejected" }));
  return updated;
}

function moderationStorageBucket(record: any) {
  if (record.decision === "approved" && record.final_storage_path) return APPROVED_PHOTO_BUCKET;
  if (["pending", "moderating", "moderation_retry", "moderation_error", "error"].includes(record.status)) return MODERATION_TEMP_BUCKET;
  return MODERATION_REVIEW_BUCKET;
}

async function profileForModerationRecord(admin: any, record: any) {
  const { data, error } = await admin.from("dancer_profiles").select("id").eq("user_id", record.user_id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");
  return data;
}

async function createNeutralNotification(admin: any, userId: string) {
  await admin.from("notifications").insert({
    recipient_id: userId,
    notification_type: "approval_status",
    channel: "in_app",
    title: "Photo not approved",
    body: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
    payload: { status: "rejected", targetType: "photo", setupStep: "photos" },
    sent_at: new Date().toISOString(),
  }).catch(() => null);
}
