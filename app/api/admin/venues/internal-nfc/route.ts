import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { PublicApiError, resolveApiError } from "@/src/lib/api-error-policy";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import { ntag424Programming } from "@/src/lib/dancr/ntag424";
import { createInternalGrant, internalGrantCookie, openInternalTagKeys, sealInternalTagKeys } from "@/src/lib/dancr/internal-tap-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
const columns = "id,venue_id,label,token,active,updated_at,tag:internal_nfc_tags!internal_nfc_tags_link_id_fkey(id,uid,status,generation,verified_at)";
function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new PublicApiError("INVALID_REQUEST", "Choose a club and table.", 400);
  return value;
}
async function authorize(request: Request) {
  const auth = await createRequestSupabaseContext(request, { role: "admin" });
  await requireAdmin(auth.client, auth.user.id);
  return { ...auth, admin: createAdminSupabaseClient() };
}
function failure(error: unknown) {
  const resolved = resolveApiError(error, "Unable to update table NFC setup. Refresh and try again.");
  return NextResponse.json(resolved.body, { status: resolved.status, headers });
}
export async function GET(request: Request) {
  try {
    const { admin, session } = await authorize(request);
    const venueId = uuid(new URL(request.url).searchParams.get("venueId"));
    const result = await admin.from("internal_roster_links").select(columns).eq("venue_id", venueId).eq("kind", "table").order("created_at");
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, venueId, links: result.data || [], session }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { admin, user, session } = await authorize(request);
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new PublicApiError("FORBIDDEN", "Open Site Admin to manage stickers.", 403);
    const body = await readBoundedJsonObject(request, { maxBytes: 1024, invalidMessage: "Invalid sticker setup.", tooLargeMessage: "Invalid sticker setup." });
    const venueId = uuid(body.venueId), linkId = uuid(body.linkId);
    const linkResult = await admin.from("internal_roster_links").select("id,token").eq("id", linkId).eq("venue_id", venueId).eq("kind", "table").eq("active", true).maybeSingle();
    if (linkResult.error) throw linkResult.error;
    const link = linkResult.data;
    if (!link) throw new PublicApiError("NOT_FOUND", "Active table not found.", 404);
    if (body.action === "preview") {
      const issued = createInternalGrant({ link: link.id, token: link.token, actor: user.id, tag: null, generation: null });
      const response = NextResponse.json({ ok: true, href: `/internal/club/${link.token}`, session }, { headers });
      response.headers.append("set-cookie", internalGrantCookie(link.token, issued.value, new URL(request.url).protocol === "https:"));
      return response;
    }
    let result = await admin.from("internal_nfc_tags").select("*").eq("link_id", linkId).maybeSingle();
    if (result.error) throw result.error;
    if (body.action === "prepare") {
      const uid = typeof body.uid === "string" ? body.uid.replace(/[\s:]/g, "").toUpperCase() : "";
      if (!/^04[\dA-F]{12}$/.test(uid)) throw new PublicApiError("INVALID_REQUEST", "Enter the sticker’s 7-byte UID from your NFC reader.", 400);
      if (result.data && result.data.uid !== uid) throw new PublicApiError("CONFLICT", "This table already has a sticker. Disable this table assignment and create a new one for a replacement.", 409);
      if (!result.data) {
        const id = randomUUID();
        const encrypted_keys = sealInternalTagKeys(id, { adminKey: randomBytes(16).toString("hex"), metaKey: randomBytes(16).toString("hex"), fileKey: randomBytes(16).toString("hex") });
        const inserted = await admin.from("internal_nfc_tags").insert({ id, link_id: linkId, uid, encrypted_keys, created_by: user.id });
        if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
        result = await admin.from("internal_nfc_tags").select("*").eq("link_id", linkId).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data || result.data.uid !== uid) throw new PublicApiError("CONFLICT", "This UID is already assigned to another table. Refresh setup.", 409);
      }
    }
    const tag = result.data;
    if (!tag) throw new PublicApiError("NOT_FOUND", "Assign a sticker first.", 404);
    if (body.action === "prepare" || body.action === "settings") {
      return NextResponse.json({ ok: true, session, programming: { uid: tag.uid, ...ntag424Programming(publicAppUrl(), tag.id), ...openInternalTagKeys(tag.id, tag.encrypted_keys) } }, { headers });
    }
    if (!["activate", "disable"].includes(String(body.action))) throw new PublicApiError("INVALID_REQUEST", "Choose a sticker action.", 400);
    if (body.generation !== tag.generation) throw new PublicApiError("CONFLICT", "The sticker changed. Refresh setup.", 409);
    if (body.action === "activate" && !tag.verified_at) throw new PublicApiError("CONFLICT", "Program and test the physical sticker before activating it.", 409);
    const changed = await admin.from("internal_nfc_tags").update({ status: body.action === "activate" ? "active" : "disabled", generation: randomUUID() })
      .eq("id", tag.id).eq("generation", tag.generation).select("id").maybeSingle();
    if (changed.error) throw changed.error;
    if (!changed.data) throw new PublicApiError("CONFLICT", "The sticker changed. Refresh setup.", 409);
    return NextResponse.json({ ok: true, session }, { headers });
  } catch (error) { return failure(error); }
}
