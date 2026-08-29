import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getContentReports, requireAdmin, updateContentReport } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_ACTIONS = new Set(["resolved", "removed"]);
const MAX_REPORT_ACTION_BODY_BYTES = 2_048;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const status = new URL(request.url).searchParams.get("status") || "open";
    const reports = await getContentReports(createAdminSupabaseClient(), status);

    return NextResponse.json({ ok: true, reports, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load content reports.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_REPORT_ACTION_BODY_BYTES,
      invalidMessage: "Invalid report action request.",
      tooLargeMessage: "Report action request is too large.",
    });
    const reportId = typeof body?.reportId === "string" ? body.reportId.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() : "";

    if (!reportId) {
      return NextResponse.json({ ok: false, error: "Missing reportId." }, { status: 400 });
    }

    if (!REPORT_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "Action must be resolved or removed." }, { status: 400 });
    }

    const report = await updateContentReport(createAdminSupabaseClient(), user.id, reportId, action as "resolved" | "removed");

    return NextResponse.json({ ok: true, report, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to update content report.");
  }
}
