import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  getVenueDancerVerificationState,
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
    await requireVenueAccount(client, user.id);
    const token = new URL(request.url).searchParams.get("token");
    const state = await getVenueDancerVerificationState(createAdminSupabaseClient(), user.id, token);
    return noStoreJson({ ok: true, ...state });
  } catch (error) {
    return affiliationApiError(error, "Unable to load dancer verification.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueAccount(client, user.id);
    return noStoreJson({
      ok: false,
      error: "Manager QR approval has been retired. Dancers add affiliation by tapping the venue's dressing-room NFC sticker.",
      replacement: "dressing_room_nfc",
    }, 410);
  } catch (error) {
    return affiliationApiError(error, "Unable to approve dancer verification.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireVenueAccount(client, user.id);
    const body = await readBody(request);
    const affiliation = await revokeDancerVenueAffiliation(createAdminSupabaseClient(), {
      actorUserId: user.id,
      affiliationId: typeof body.affiliationId === "string" ? body.affiliationId : "",
      reason: typeof body.reason === "string" ? body.reason : "Venue manager removed affiliation.",
    });
    return noStoreJson({
      ok: true,
      affiliation,
      message: `${String(affiliation.stageName)} is no longer verified at this venue.`,
    });
  } catch (error) {
    return affiliationApiError(error, "Unable to remove dancer verification.");
  }
}

async function requireVenueAccount(client: any, userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "venue" || account.accountState !== "active") {
    throw new VenueAffiliationUserError("Active venue manager account required.");
  }
  return account;
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
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  console.error("VENUE_DANCER_VERIFICATION_FAILED", error);
  return apiError(error, fallback);
}
