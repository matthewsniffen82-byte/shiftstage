import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  getAdminVenueOwnershipClaims,
  reviewVenueOwnershipClaim,
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
    const claims = await getAdminVenueOwnershipClaims(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, claims });
  } catch (error) {
    return apiError(error, "Unable to load venue ownership claims.");
  }
}
export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json();
    const claimId = typeof body?.claimId === "string" ? body.claimId.trim() : "";
    const status = body?.status === "approved" || body?.status === "rejected" ? body.status : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
    if (!claimId) {
      return NextResponse.json({ ok: false, error: "Missing venue ownership claim." }, { status: 400 });
    }
    if (!status) {
      return NextResponse.json({ ok: false, error: "Status must be approved or rejected." }, { status: 400 });
    }

    const claim = await reviewVenueOwnershipClaim(createAdminSupabaseClient(), {
      claimId,
      adminId: user.id,
      status,
      notes,
    });
    return NextResponse.json({
      ok: true,
      claim,
      message: status === "approved"
        ? `${claim.venue?.name || "Venue"} is now connected to the verified owner account.`
        : "Venue ownership claim rejected and the claimant was notified.",
    });
  } catch (error) {
    const userMessage = error instanceof VenueClaimUserError ? error.message : "";
    if (!userMessage) console.error("VENUE_OWNERSHIP_CLAIM_REVIEW_FAILED", error);
    return apiError(
      new Error(userMessage || "Unable to review venue ownership claim."),
      "Unable to review venue ownership claim.",
      userMessage ? 400 : 500,
    );
  }
}
