import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { numberedTableLabel } from "@/src/lib/dancr/table-label";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };
function uuid(value: unknown) {
  // Seeded database row IDs do not necessarily carry UUID version/variant bits.
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid club and table assignment.", 400);
  }
  return value;
}
async function authorize(request: Request) {
  const context = await createRequestSupabaseContext(request, { role: "admin" });
  await requireAdmin(context.client, context.user.id);
  return { ...context, admin: createAdminSupabaseClient() };
}
function tableAssignmentError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? error.message : "";
  if (message === "TABLE_LABEL_EXISTS") return new PublicApiError("CONFLICT", "An active table already uses that label.", 409);
  if (message === "TABLE_QR_CHANGED") return new PublicApiError("CONFLICT", "This table changed. Refresh the list before editing it.", 409);
  if (message === "VENUE_NOT_FOUND" || message === "TABLE_QR_NOT_FOUND") return new PublicApiError("NOT_FOUND", "Club or table assignment not found.", 404);
  if (message === "ADMIN_REQUIRED") return new PublicApiError("FORBIDDEN", "Admin access required.", 403);
  return error;
}
export async function POST(request: Request) {
  try {
    const { admin, user, session } = await authorize(request);
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      throw new PublicApiError("FORBIDDEN", "Open Site Admin to manage table assignments.", 403);
    }
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid table assignment.", tooLargeMessage: "Table assignment request is too large." });
    const venueId = uuid(body.venueId);
    const id = uuid(body.id);
    if (!["create", "rename", "disable"].includes(String(body.action))) throw new PublicApiError("INVALID_REQUEST", "Choose a table assignment action.", 400);
    const label = numberedTableLabel(body.label);
    if (body.action !== "disable" && !label) {
      throw new PublicApiError("INVALID_REQUEST", "Enter a positive whole table number.", 400);
    }
    if (body.action === "rename" && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
      throw new PublicApiError("INVALID_REQUEST", "Refresh the table assignment before renaming it.", 400);
    }
    const { data, error } = await admin.rpc("admin_manage_table_qr", {
      p_actor: user.id, p_venue: venueId, p_action: body.action,
      p_data: { id, label, ...(body.action === "rename" ? { expectedUpdatedAt: body.expectedUpdatedAt } : {}) },
    });
    if (error) throw error;
    if (!data || data.id !== id || data.venue_id !== venueId || data.kind !== "table"
      || typeof data.active !== "boolean" || (body.action === "disable" ? data.active : !data.active || data.label !== label)) {
      throw new Error("Table assignment save could not be confirmed.");
    }
    return NextResponse.json({ ok: true, venueId, link: { id, label: data.label, active: data.active }, session }, { headers });
  } catch (error) { return apiError(tableAssignmentError(error), "Unable to save the table assignment."); }
}
