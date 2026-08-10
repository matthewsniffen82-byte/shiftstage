import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  createVenueNfcTag,
  listVenueNfcTags,
  rotateVenueNfcTag,
  setVenueNfcTagStatus,
  type NfcTagType,
} from "@/src/lib/dancr/nfc";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { client, user } = authContext;
    await requireActiveVenue(client, user.id);
    const tags = await listVenueNfcTags(createAdminSupabaseClient(), user.id);
    return noStore({ ok: true, tags, session: authContext.session || null });
  } catch (error) {
    return apiError(error, "Unable to load venue NFC tags.");
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { client, user } = authContext;
    await requireActiveVenue(client, user.id);
    const body = await readBody(request);
    const created = await createVenueNfcTag(createAdminSupabaseClient(), {
      ownerUserId: user.id,
      type: body.type as NfcTagType,
      label: typeof body.label === "string" ? body.label : "",
    });
    const programmingUrl = new URL(`/nfc/${created.token}`, request.url).toString();
    console.info("VENUE_NFC_TAG_CREATED", {
      venueId: created.tag.venueId,
      tagId: created.tag.id,
      type: created.tag.type,
    });
    return noStore({
      ok: true,
      tag: created.tag,
      session: authContext.session || null,
      programmingUrl,
      message: "NFC programming URL created. It is shown once; write it to the sticker now.",
    }, 201);
  } catch (error) {
    return apiError(error, "Unable to create venue NFC tag.", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { client, user } = authContext;
    await requireActiveVenue(client, user.id);
    const body = await readBody(request);
    const tagId = typeof body.tagId === "string" ? body.tagId : "";
    const admin = createAdminSupabaseClient();
    if (body.action === "rotate") {
      const rotated = await rotateVenueNfcTag(admin, { ownerUserId: user.id, tagId });
      const programmingUrl = new URL(`/nfc/${rotated.token}`, request.url).toString();
      console.info("VENUE_NFC_TAG_ROTATED", { tagId, replacementTagId: rotated.tag.id, venueId: rotated.tag.venueId });
      return noStore({
        ok: true,
        tag: rotated.tag,
        session: authContext.session || null,
        programmingUrl,
        message: "The old sticker URL was revoked. Program the replacement URL now; it is shown once.",
      });
    }
    if (body.action !== "enable" && body.action !== "disable") {
      return NextResponse.json({ ok: false, error: "Choose enable, disable, or rotate." }, { status: 400 });
    }
    const tag = await setVenueNfcTagStatus(admin, {
      ownerUserId: user.id,
      tagId,
      status: body.action === "enable" ? "active" : "disabled",
    });
    return noStore({
      ok: true,
      tag,
      session: authContext.session || null,
      message: tag.status === "active" ? "NFC tag enabled." : "NFC tag disabled.",
    });
  } catch (error) {
    return apiError(error, "Unable to update venue NFC tag.", 400);
  }
}

async function requireActiveVenue(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "venue" || account.accountState !== "active") {
    throw new Error("Active venue account required.");
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
