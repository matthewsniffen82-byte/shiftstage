import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { PublicApiError, resolveApiError } from "@/src/lib/api-error-policy";
import { verifyNtag424 } from "@/src/lib/dancr/ntag424";
import { enforcePublicRequestRateLimit, PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";
import { createInternalGrant, internalGrantCookie, openInternalTagKeys, readInternalGrant } from "@/src/lib/dancr/internal-tap-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
const unavailable = () => new PublicApiError("FORBIDDEN", "This tap could not be verified. Tap the club’s NFC sticker again.", 403);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw unavailable();
    const { id } = await context.params;
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw unavailable();
    const body = await readBoundedJsonObject(request, { maxBytes: 512, invalidMessage: "Invalid tap.", tooLargeMessage: "Invalid tap." });
    if (typeof body.e !== "string" || typeof body.c !== "string") throw unavailable();
    const admin = createAdminSupabaseClient();
    await enforcePublicRequestRateLimit(admin, { namespace: "internal_nfc_tap", request, subject: id, windowSeconds: 60, ipLimit: 600, subjectLimit: 120 });
    const result = await admin.from("internal_nfc_tags").select("id,link_id,uid,encrypted_keys,status,generation").eq("id", id).maybeSingle();
    if (result.error) throw result.error;
    const tag = result.data;
    if (!tag || tag.status === "disabled") throw unavailable();
    const keys = openInternalTagKeys(tag.id, tag.encrypted_keys);
    const verified = verifyNtag424({ encrypted: body.e, mac: body.c, uid: tag.uid, ...keys });
    if (!verified) throw unavailable();
    const consumed = await admin.rpc("consume_internal_nfc_tap", { p_id: tag.id, p_generation: tag.generation, p_counter: verified.counter });
    if (consumed.error) {
      if (["40001", "42501"].includes(consumed.error.code)) throw unavailable();
      throw consumed.error;
    }
    if (consumed.data?.status === "staged") return NextResponse.json({ ok: true, tested: true }, { headers });
    if (consumed.data?.status !== "active" || consumed.data.link !== tag.link_id || consumed.data.generation !== tag.generation) throw unavailable();
    const { token, link, generation } = consumed.data;
    const current = readInternalGrant(request, token);
    // A new tap during an existing visit must not silently extend its expiry.
    const keep = current && !current.actor && current.link === link && current.tag === id && current.generation === generation;
    const issued = keep ? null : createInternalGrant({ link, token, tag: id, generation, actor: null });
    const response = NextResponse.json({ ok: true, href: `/internal/club/${token}`, expiresAt: (issued?.grant.expires || current!.expires) * 1000 }, { headers });
    if (issued) response.headers.append("set-cookie", internalGrantCookie(token, issued.value, new URL(request.url).protocol === "https:"));
    return response;
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) return NextResponse.json({ ok: false, error: "Please wait a moment before trying another tap." }, { status: 429, headers: { ...headers, "retry-after": String(error.retryAfterSeconds) } });
    const resolved = resolveApiError(error, "Unable to open this club. Please tap the sticker again.");
    return NextResponse.json(resolved.body, { status: resolved.status, headers });
  }
}
