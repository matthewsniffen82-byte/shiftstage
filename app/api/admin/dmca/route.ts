import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  applyDmcaAdminAction,
  getAdminDmcaState,
  type DmcaAdminAction,
  updateDmcaAgent,
} from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<DmcaAdminAction>([
  "request_information",
  "reject",
  "disable",
  "record_court_action",
  "restore",
  "close",
]);
const MAX_DMCA_ADMIN_BODY_BYTES = 32_768;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const reviewCaseId = new URL(request.url).searchParams.get("caseId") || undefined;
    const state = await getAdminDmcaState(createAdminSupabaseClient(), reviewCaseId);
    return NextResponse.json({ ok: true, ...state, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load copyright operations.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_DMCA_ADMIN_BODY_BYTES,
      invalidMessage: "Invalid copyright admin request.",
      tooLargeMessage: "Copyright admin request is too large.",
    });
    const admin = createAdminSupabaseClient();

    if (body?.resource === "agent") {
      const { agent, auditNeedsReview } = await updateDmcaAgent(admin, user.id, body);
      return NextResponse.json({
        ok: true,
        agent,
        partial: auditNeedsReview,
        auditNeedsReview,
        message: auditNeedsReview
          ? "Copyright agent details saved. The audit entry could not be confirmed. Review the audit log; do not repeat the save to create an audit entry."
          : "Copyright agent details saved.",
        session: session || null,
      });
    }

    const caseId = typeof body?.caseId === "string" ? body.caseId.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() as DmcaAdminAction : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 4000) : "";
    if (!caseId || !action || !ACTIONS.has(action)) {
      return NextResponse.json(
        { ok: false, error: "Choose a copyright case and a valid action." },
        { status: 400 },
      );
    }

    const result = await applyDmcaAdminAction(admin, user.id, caseId, action, notes, body.expectedUpdatedAt);
    const deliveryNeedsReview = "deliveryNeedsReview" in result && result.deliveryNeedsReview;
    return NextResponse.json({
      ok: true,
      result,
      partial: Boolean(deliveryNeedsReview),
      message: actionMessage(action) + (deliveryNeedsReview
        ? " Email delivery could not be confirmed. Review notification delivery; do not repeat the completed action."
        : ""),
      session: session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to update copyright case.", 400);
  }
}

function actionMessage(action: DmcaAdminAction) {
  if (action === "disable") return "The reported video was disabled and the copyright strike was recorded.";
  if (action === "restore") return "The copyright case was resolved. Other account or content restrictions may still apply.";
  if (action === "record_court_action") return "Court action recorded. Automatic restoration is blocked.";
  if (action === "request_information") return "The case was marked as needing more information.";
  if (action === "reject") return "The notice was rejected.";
  return "The copyright case was closed.";
}
