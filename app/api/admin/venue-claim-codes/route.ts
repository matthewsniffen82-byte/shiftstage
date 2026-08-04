import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminVenueClaimCodes,
  issueVenueClaimCode,
  revokeVenueClaimCode,
  VenueClaimUserError,
} from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const claimCodes = await getAdminVenueClaimCodes(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, claimCodes });
  } catch (error) {
    return apiError(error, "Unable to load venue access codes.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json();
    const action = body?.action === "issue" || body?.action === "revoke" ? body.action : "";
    if (!action) {
      return NextResponse.json({ ok: false, error: "Action must be issue or revoke." }, { status: 400 });
    }

    if (action === "issue") {
      const venueId = typeof body?.venueId === "string" ? body.venueId.trim() : "";
      const expiresInDays = Number(body?.expiresInDays ?? 7);
      const result = await issueVenueClaimCode(createAdminSupabaseClient(), {
        venueId,
        adminId: user.id,
        expiresInDays,
      });
      return NextResponse.json({
        ok: true,
        ...result,
        message: "One-time venue signup access code created. Copy it now; it cannot be retrieved later.",
      }, { status: 201 });
    }

    const codeId = typeof body?.codeId === "string" ? body.codeId.trim() : "";
    const claimCode = await revokeVenueClaimCode(createAdminSupabaseClient(), {
      codeId,
      adminId: user.id,
    });
    return NextResponse.json({ ok: true, claimCode, message: "Venue access code revoked." });
  } catch (error) {
    const userMessage = error instanceof VenueClaimUserError ? error.message : "";
    if (!userMessage) console.error("VENUE_CLAIM_CODE_ADMIN_FAILED", error);
    return apiError(
      new Error(userMessage || "Unable to manage venue access code."),
      "Unable to manage venue access code.",
      userMessage ? 400 : 500,
    );
  }
}
