import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET_TYPES = new Set(["dancer_profile", "venue", "shift", "contact_message"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function reporterIdForRequest(client: ReturnType<typeof createAdminSupabaseClient>, request: Request) {
  const token = getBearerToken(request);
  if (!token) return null;

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  return data.user.id;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
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

    const client = createAdminSupabaseClient();
    const { data, error } = await (client as any)
      .from("content_reports")
      .insert({
        reporter_id: await reporterIdForRequest(client, request),
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
    return apiError(error, "Unable to submit report.");
  }
}
