import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_TYPES = new Set(["dancer_profile", "venue", "shift", "tv_video", "contact_message"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TARGET_LABEL_LENGTH = 160;
const MAX_REASON_LENGTH = 120;
const MAX_DETAILS_LENGTH = 2000;
const MAX_REPORT_BODY_BYTES = 4_096;

async function reporterIdForRequest(client: ReturnType<typeof createAdminSupabaseClient>, request: Request) {
  const token = getBearerToken(request);
  if (!token) return null;

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  return data.user.id;
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_REPORT_BODY_BYTES,
      invalidMessage: "Invalid report payload.",
      tooLargeMessage: "Report payload is too large.",
    });
    const targetType = typeof body?.targetType === "string" ? body.targetType.trim() : "";
    const submittedTargetId = typeof body?.targetId === "string" && body.targetId.trim() ? body.targetId.trim() : null;
    const targetId = submittedTargetId && UUID_PATTERN.test(submittedTargetId) ? submittedTargetId : null;
    const targetLabel = typeof body?.targetLabel === "string" ? body.targetLabel.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const details = typeof body?.details === "string" && body.details.trim() ? body.details.trim() : null;

    if (!TARGET_TYPES.has(targetType)) {
      return NextResponse.json({ ok: false, error: "Invalid report target." }, { status: 400 });
    }

    if (!targetLabel) {
      return NextResponse.json({ ok: false, error: "Missing report target." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ ok: false, error: "Missing report reason." }, { status: 400 });
    }

    if (targetLabel.length > MAX_TARGET_LABEL_LENGTH) {
      return NextResponse.json({ ok: false, error: "Report target is too long." }, { status: 400 });
    }

    if (reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json({ ok: false, error: "Report reason is too long." }, { status: 400 });
    }

    if (details && details.length > MAX_DETAILS_LENGTH) {
      return NextResponse.json({ ok: false, error: "Report details are too long." }, { status: 400 });
    }

    if (submittedTargetId && !targetId) {
      return NextResponse.json({ ok: false, error: "Invalid report target id." }, { status: 400 });
    }

    const client = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(client, {
      namespace: "content_report",
      request,
      subject: `${targetType}:${targetId || targetLabel}`,
      windowSeconds: 10 * 60,
      ipLimit: 8,
      subjectLimit: 2,
    });
    const reporterId = await reporterIdForRequest(client, request);

    const { data, error } = await (client as any)
      .from("content_reports")
      .insert({
        reporter_id: reporterId,
        target_type: targetType,
        target_id: targetId,
        target_label: targetLabel,
        reason,
        details,
        status: "open",
      })
      .select("id, target_type, target_id, target_label, reason, details, status, created_at")
      .single();

    if (error) throw error;

    console.info(JSON.stringify({
      event: "content_report.created",
      reportId: data.id,
      targetType: data.target_type,
      targetId: data.target_id,
      attributedReporter: Boolean(reporterId),
    }));

    return NextResponse.json({
      ok: true,
      report: {
        id: data.id,
        targetType: data.target_type,
        targetId: data.target_id,
        targetLabel: data.target_label,
        reason: data.reason,
        details: data.details,
        status: data.status,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many reports were submitted. Please wait and try again." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to submit report.");
  }
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}
