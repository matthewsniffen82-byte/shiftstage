import { NextResponse } from "next/server";
import { runWithServerJob } from "@/src/lib/server-job";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { withSignedThumbnail, approveReviewRecord, rejectReviewRecord } from "@/src/lib/dancr/image-review";

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

    if (decision === "review") query = query.not("upload_context", "like", "profile_%");
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
    return await runWithServerJob(async () => {
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
    });
  } catch (error) {
    return apiError(error, "Unable to update image moderation record.");
  }
}
