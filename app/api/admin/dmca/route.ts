import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
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

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const state = await getAdminDmcaState(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, ...state, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load copyright operations.");
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json();
    const admin = createAdminSupabaseClient();

    if (body?.resource === "agent") {
      const agent = await updateDmcaAgent(admin, user.id, body);
      return NextResponse.json({
        ok: true,
        agent,
        message: "Copyright agent details saved.",
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

    const result = await applyDmcaAdminAction(admin, user.id, caseId, action, notes);
    return NextResponse.json({
      ok: true,
      result,
      message: actionMessage(action),
      session: session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to update copyright case.", 400);
  }
}

function actionMessage(action: DmcaAdminAction) {
  if (action === "disable") return "The reported video was disabled and the uploader was notified.";
  if (action === "restore") return "The content was restored and the copyright strike was rescinded.";
  if (action === "record_court_action") return "Court action recorded. Automatic restoration is blocked.";
  if (action === "request_information") return "The claimant was asked for more information.";
  if (action === "reject") return "The notice was rejected and the claimant was notified.";
  return "The copyright case was closed.";
}
