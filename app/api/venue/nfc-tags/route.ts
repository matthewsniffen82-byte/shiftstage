import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { listVenueNfcTags } from "@/src/lib/dancr/nfc";
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
    return noStore({
      ok: false,
      error: "MyDancr supplies and programs venue NFC stickers. Contact MyDancr support for a new or replacement sticker.",
      session: authContext.session || null,
    }, 403);
  } catch (error) {
    return apiError(error, "Unable to verify venue NFC access.", 403);
  }
}

export async function PATCH(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { client, user } = authContext;
    await requireActiveVenue(client, user.id);
    return noStore({
      ok: false,
      error: "Only MyDancr can activate, disable, or replace venue NFC stickers. Contact support if a sticker is lost, damaged, or moved.",
      session: authContext.session || null,
    }, 403);
  } catch (error) {
    return apiError(error, "Unable to verify venue NFC access.", 403);
  }
}

async function requireActiveVenue(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "venue" || account.accountState !== "active") {
    throw new Error("Active venue account required.");
  }
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
