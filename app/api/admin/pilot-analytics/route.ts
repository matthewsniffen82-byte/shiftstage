import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminPilotAnalytics,
  upsertAdminPilotNightReport,
  validatePilotDateRange,
} from "@/src/lib/dancr/pilot-analytics";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_PILOT_REPORT_BODY_BYTES = 16_384;

export async function GET(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const params = new URL(request.url).searchParams;
    const venueId = requiredUuid(params.get("venueId"), "Pilot venue is required.");
    const startDate = requiredText(params.get("startDate"), "Pilot start date is required.");
    const endDate = requiredText(params.get("endDate"), "Pilot end date is required.");
    validatePilotDateRange(startDate, endDate);
    const analytics = await getAdminPilotAnalytics(createAdminSupabaseClient(), venueId, startDate, endDate);
    return NextResponse.json({ ok: true, analytics, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to load pilot analytics.", isInputError(error) ? 400 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const { client, session, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_PILOT_REPORT_BODY_BYTES,
      invalidMessage: "Invalid pilot report request.",
      tooLargeMessage: "Pilot report request is too large.",
    });
    const venueId = requiredUuid(body.venueId, "Pilot venue is required.");
    const serviceDate = requiredText(body.serviceDate, "Service date is required.");
    const totalDoorCount = Number(body.totalDoorCount);
    const pilotCostCents = Number(body.pilotCostCents || 0);
    const report = await upsertAdminPilotNightReport(createAdminSupabaseClient(), user.id, {
      venueId,
      serviceDate,
      totalDoorCount,
      pilotCostCents,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true, report, session: session || null });
  } catch (error) {
    return apiError(error, "Unable to save the pilot night report.", isInputError(error) ? 400 : 500);
  }
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function requiredUuid(value: unknown, message: string) {
  const id = requiredText(value, message);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Pilot venue identifier is invalid.");
  }
  return id;
}

function isInputError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /required|invalid|must|limited/i.test(message);
}
