import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };
const columns = "id,venue_id,kind,label,token,active,updated_at";
function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid venue and table code.", 400);
  }
  return value;
}
async function authorize(request: Request) {
  const context = await createRequestSupabaseContext(request, { role: "admin" });
  await requireAdmin(context.client, context.user.id);
  return { ...context, admin: createAdminSupabaseClient() };
}
function tableQrError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? error.message : "";
  if (message === "TABLE_LABEL_EXISTS") return new PublicApiError("CONFLICT", "An active table already uses that label.", 409);
  if (message === "TABLE_QR_CHANGED") return new PublicApiError("CONFLICT", "This code changed. Refresh the list before editing it.", 409);
  if (message === "VENUE_NOT_FOUND" || message === "TABLE_QR_NOT_FOUND") return new PublicApiError("NOT_FOUND", "Venue or table code not found.", 404);
  if (message === "ADMIN_REQUIRED") return new PublicApiError("FORBIDDEN", "Admin access required.", 403);
  return error;
}
export async function GET(request: Request) {
  try {
    const { admin, session } = await authorize(request);
    const params = new URL(request.url).searchParams;
    const venueId = uuid(params.get("venueId"));
    const venue = await admin.from("venues").select("id").eq("id", venueId).maybeSingle();
    if (venue.error) throw venue.error;
    if (!venue.data) throw new PublicApiError("NOT_FOUND", "Venue not found.", 404);
    if (params.has("download")) {
      const id = uuid(params.get("download"));
      const result = await admin.from("internal_roster_links").select(columns).eq("id", id)
        .eq("venue_id", venueId).eq("kind", "table").eq("active", true).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new PublicApiError("NOT_FOUND", "Active table code not found.", 404);
      const url = new URL(`/internal/club/${result.data.token}`, process.env.NEXT_PUBLIC_SITE_URL || "https://www.mydancr.com").href;
      const imageDataUrl = await QRCode.toDataURL(url, { width: 600, margin: 4, errorCorrectionLevel: "M" });
      return NextResponse.json({ ok: true, venueId, id, imageDataUrl, session }, { headers });
    }
    const { data, error } = await admin.from("internal_roster_links").select(columns)
      .eq("venue_id", venueId).eq("kind", "table").order("active", { ascending: false }).order("created_at");
    if (error) throw error;
    return NextResponse.json({ ok: true, venueId, links: data || [], session }, { headers });
  } catch (error) { return apiError(tableQrError(error), "Unable to load table QR codes."); }
}
export async function POST(request: Request) {
  try {
    const { admin, user, session } = await authorize(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid table code.", tooLargeMessage: "Table code request is too large." });
    const venueId = uuid(body.venueId);
    const id = uuid(body.id);
    if (!["create", "rename", "disable"].includes(String(body.action))) throw new PublicApiError("INVALID_REQUEST", "Choose a table code action.", 400);
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (body.action !== "disable" && (!label || label.length > 60 || /[\u0000-\u001f\u007f]/.test(label))) {
      throw new PublicApiError("INVALID_REQUEST", "Enter a table label of 1 to 60 characters.", 400);
    }
    if (body.action === "rename" && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
      throw new PublicApiError("INVALID_REQUEST", "Refresh the table code before renaming it.", 400);
    }
    const { data, error } = await admin.rpc("admin_manage_table_qr", {
      p_actor: user.id, p_venue: venueId, p_action: body.action,
      p_data: { id, label, ...(body.action === "rename" ? { expectedUpdatedAt: body.expectedUpdatedAt } : {}) },
    });
    if (error) throw error;
    if (!data || data.id !== id || data.venue_id !== venueId || data.kind !== "table"
      || typeof data.active !== "boolean" || (body.action === "disable" ? data.active : !data.active || data.label !== label)) {
      throw new Error("Table code save could not be confirmed.");
    }
    return NextResponse.json({ ok: true, venueId, link: data, session }, { headers });
  } catch (error) { return apiError(tableQrError(error), "Unable to save table QR code."); }
}
