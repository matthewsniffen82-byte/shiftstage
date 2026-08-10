import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAdminVenues, requireAdmin } from "@/src/lib/dancr/admin";
import {
  createAdminVenueNfcTag,
  listAdminNfcTags,
  rotateAdminVenueNfcTag,
  setAdminVenueNfcTagStatus,
  type NfcTagType,
} from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    await requireAdmin(authContext.client, authContext.user.id);
    const admin = createAdminSupabaseClient();
    const [tags, venues] = await Promise.all([
      listAdminNfcTags(admin),
      getAdminVenues(admin),
    ]);
    return noStore({
      ok: true,
      tags,
      venues: venues
        .filter((venue: any) => venue.is_active === true)
        .map((venue: any) => ({
          id: String(venue.id),
          name: String(venue.name),
          slug: String(venue.slug),
          city: String(venue.city),
          state: venue.state ? String(venue.state) : null,
          isClaimed: Boolean(venue.owner_user_id),
        })),
      session: authContext.session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to load MyDancr NFC inventory.");
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    await requireAdmin(authContext.client, authContext.user.id);
    const body = await readBody(request);
    const created = await createAdminVenueNfcTag(createAdminSupabaseClient(), {
      adminUserId: authContext.user.id,
      venueId: typeof body.venueId === "string" ? body.venueId : "",
      type: body.type as NfcTagType,
      label: typeof body.label === "string" ? body.label : "",
    });
    const programmingUrl = new URL(`/nfc/${created.token}`, request.url).toString();
    console.info("ADMIN_NFC_STICKER_PROVISIONED", {
      adminUserId: authContext.user.id,
      venueId: created.tag.venueId,
      tagId: created.tag.id,
      type: created.tag.type,
    });
    return noStore({
      ok: true,
      tag: created.tag,
      programmingUrl,
      session: authContext.session || null,
      message: "Sticker assigned. Program this one-time URL, test the physical sticker, then lock it read-only.",
    }, 201);
  } catch (error) {
    return apiError(error, "Unable to provision NFC sticker.", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    await requireAdmin(authContext.client, authContext.user.id);
    const body = await readBody(request);
    const tagId = typeof body.tagId === "string" ? body.tagId : "";
    const admin = createAdminSupabaseClient();

    if (body.action === "rotate") {
      const rotated = await rotateAdminVenueNfcTag(admin, { adminUserId: authContext.user.id, tagId });
      const programmingUrl = new URL(`/nfc/${rotated.token}`, request.url).toString();
      console.info("ADMIN_NFC_STICKER_ROTATED", {
        adminUserId: authContext.user.id,
        revokedTagId: tagId,
        replacementTagId: rotated.tag.id,
        venueId: rotated.tag.venueId,
      });
      return noStore({
        ok: true,
        tag: rotated.tag,
        programmingUrl,
        session: authContext.session || null,
        message: "Old sticker URL revoked. Program and test the replacement sticker with this one-time URL.",
      });
    }

    if (body.action !== "enable" && body.action !== "disable") {
      return noStore({ ok: false, error: "Choose enable, disable, or rotate." }, 400);
    }
    const tag = await setAdminVenueNfcTagStatus(admin, {
      adminUserId: authContext.user.id,
      tagId,
      status: body.action === "enable" ? "active" : "disabled",
    });
    console.info("ADMIN_NFC_STICKER_STATUS_CHANGED", {
      adminUserId: authContext.user.id,
      tagId,
      status: tag.status,
    });
    return noStore({
      ok: true,
      tag,
      session: authContext.session || null,
      message: tag.status === "active" ? "Sticker enabled." : "Sticker disabled.",
    });
  } catch (error) {
    return apiError(error, "Unable to update NFC sticker.", 400);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
