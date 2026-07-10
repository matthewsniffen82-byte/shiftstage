import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { APPROVED_PHOTO_BUCKET, MODERATION_REVIEW_BUCKET, MODERATION_TEMP_BUCKET } from "@/src/lib/dancr/image-moderation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_DECISIONS = new Set(["approved", "rejected"]);

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const admin = createAdminSupabaseClient() as any;
    const url = new URL(request.url);
    const decision = url.searchParams.get("decision") || "review";
    const page = Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0);
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
    return NextResponse.json({ ok: true, records, count: count || 0, page, pageSize });
  } catch (error) {
    return apiError(error, "Unable to load image moderation queue.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const admin = createAdminSupabaseClient() as any;
    const body = await request.json();
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
      return NextResponse.json({ ok: true, record: approved });
    }

    const rejected = await rejectReviewRecord(admin, record, user.id, notes);
    return NextResponse.json({ ok: true, record: rejected });
  } catch (error) {
    return apiError(error, "Unable to update image moderation record.");
  }
}

async function withSignedThumbnail(admin: any, record: any) {
  const bucket = record.decision === "approved" && record.final_storage_path ? APPROVED_PHOTO_BUCKET : MODERATION_REVIEW_BUCKET;
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
  const profile = await profileForModerationRecord(admin, record);
  const sourcePath = record.temporary_storage_path;
  if (!sourcePath) throw new Error("Review image is missing.");
  const { data: file, error: downloadError } = await admin.storage.from(MODERATION_REVIEW_BUCKET).download(sourcePath);
  if (downloadError || !file) throw downloadError || new Error("Unable to read review image.");

  const extension = sourcePath.split(".").pop() || "jpg";
  const finalPath = `${record.user_id}/${profile.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage.from(APPROVED_PHOTO_BUCKET).upload(finalPath, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (uploadError) throw uploadError;

  try {
    const sortOrder = await nextPhotoSortOrder(admin, profile.id);
    const isPrimary = record.upload_context === "profile_main" && sortOrder === 0;
    const { data: photo, error: photoError } = await admin
      .from("dancer_photos")
      .insert({
        dancer_id: profile.id,
        storage_path: finalPath,
        is_primary: isPrimary,
        sort_order: sortOrder,
        review_status: "approved",
      })
      .select("id")
      .single();
    if (photoError) throw photoError;

    const update = {
      image_id: photo.id,
      final_storage_path: finalPath,
      decision: "approved",
      status: "completed",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_decision: "approved",
      review_notes: notes || null,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await admin.from("image_moderation_records").update(update).eq("id", record.id).select("*").single();
    if (updateError) throw updateError;
    await admin.storage.from(MODERATION_REVIEW_BUCKET).remove([sourcePath]).catch(() => null);
    console.info(JSON.stringify({ event: "image_moderation.admin_decision", recordId: record.id, decision: "approved" }));
    return updated;
  } catch (error) {
    await admin.storage.from(APPROVED_PHOTO_BUCKET).remove([finalPath]).catch(() => null);
    throw error;
  }
}

async function rejectReviewRecord(admin: any, record: any, reviewerId: string, notes: string) {
  const sourcePath = record.temporary_storage_path;
  const update = {
    decision: "rejected",
    status: "completed",
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
    review_decision: "rejected",
    review_notes: notes || "Rejected by admin moderation.",
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = await admin.from("image_moderation_records").update(update).eq("id", record.id).select("*").single();
  if (error) throw error;
  if (sourcePath) {
    await admin.storage.from(MODERATION_REVIEW_BUCKET).remove([sourcePath]).catch(() => null);
    await admin.storage.from(MODERATION_TEMP_BUCKET).remove([sourcePath]).catch(() => null);
  }
  await createNeutralNotification(admin, record.user_id);
  console.info(JSON.stringify({ event: "image_moderation.admin_decision", recordId: record.id, decision: "rejected" }));
  return updated;
}

async function profileForModerationRecord(admin: any, record: any) {
  const { data, error } = await admin.from("dancer_profiles").select("id").eq("user_id", record.user_id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");
  return data;
}

async function nextPhotoSortOrder(admin: any, dancerId: string) {
  const { count, error } = await admin.from("dancer_photos").select("id", { count: "exact", head: true }).eq("dancer_id", dancerId);
  if (error) throw error;
  return count || 0;
}

async function createNeutralNotification(admin: any, userId: string) {
  await admin.from("notifications").insert({
    user_id: userId,
    type: "photo_moderation",
    title: "Photo not approved",
    body: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
    payload: {},
  }).catch(() => null);
}
