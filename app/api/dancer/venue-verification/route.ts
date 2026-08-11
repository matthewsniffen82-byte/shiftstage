import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getDancerNfcDashboardState } from "@/src/lib/dancr/nfc";
import {
  revokeDancerVenueAffiliation,
  VenueAffiliationUserError,
} from "@/src/lib/dancr/venue-affiliations";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "dancer" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
    }
    const state = await getDancerNfcDashboardState(createAdminSupabaseClient(), user.id);
    return noStoreJson({ ok: true, ...state });
  } catch (error) {
    return affiliationApiError(error, "Unable to load venue verification.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "dancer" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
    }
    return noStoreJson({
      ok: false,
      code: "dressing_room_nfc_required",
      error: "Venue approval QR codes are retired. Tap the venue's official MyDancr dressing-room NFC sticker to authorize access and check in.",
    }, 410);
  } catch (error) {
    return affiliationApiError(error, "Unable to create venue verification QR.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "dancer" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
    }
    const body = await readBody(request);
    const affiliation = await revokeDancerVenueAffiliation(createAdminSupabaseClient(), {
      actorUserId: user.id,
      affiliationId: typeof body.affiliationId === "string" ? body.affiliationId : "",
      reason: "Dancer removed venue affiliation.",
    });
    return noStoreJson({ ok: true, affiliation, message: "Venue NFC access removed." });
  } catch (error) {
    return affiliationApiError(error, "Unable to remove venue verification.");
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}

function affiliationApiError(error: unknown, fallback: string) {
  if (error instanceof VenueAffiliationUserError) {
    const status = /too many/i.test(error.message) ? 429 : /required|only|allowed/i.test(error.message) ? 403 : 400;
    return NextResponse.json(
      { ok: false, error: error.message },
      { status, headers: status === 429 ? { "retry-after": "3600" } : undefined },
    );
  }
  console.error("DANCER_VENUE_VERIFICATION_FAILED", error);
  return apiError(error, fallback);
}
