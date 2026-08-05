import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  getDancerVenueVerificationState,
  hashVenueAffiliationRequestIp,
  issueDancerVenueVerification,
  revokeDancerVenueAffiliation,
  VenueAffiliationUserError,
  venueAffiliationRequestIp,
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
    const state = await getDancerVenueVerificationState(createAdminSupabaseClient(), user.id);
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
    const body = await readBody(request);
    const issued = await issueDancerVenueVerification(createAdminSupabaseClient(), {
      userId: user.id,
      venueId: typeof body.venueId === "string" ? body.venueId : "",
      requestIpHash: hashVenueAffiliationRequestIp(venueAffiliationRequestIp(request)),
    });
    const verificationUrl = new URL("/", request.url);
    verificationUrl.searchParams.set("venueVerify", issued.token);
    const qrDataUrl = await QRCode.toDataURL(verificationUrl.toString(), {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 320,
      color: { dark: "#050507", light: "#ffffff" },
    });
    return noStoreJson({
      ok: true,
      verification: {
        venue: issued.venue,
        expiresAt: issued.expiresAt,
        verificationUrl: verificationUrl.toString(),
        qrDataUrl,
      },
      message: `Show this personal QR to ${issued.venue.name}'s verified manager.`,
    }, 201);
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
    return noStoreJson({ ok: true, affiliation, message: "Venue verification removed." });
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
