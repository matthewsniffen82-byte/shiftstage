import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getLatestVenueOwnershipClaim } from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kept read-only so venue accounts with a claim submitted before the access-code
// signup launch can still see its final status.
export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active venue account required." }, { status: 403 });
    }
    const claim = await getLatestVenueOwnershipClaim(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, claim });
  } catch (error) {
    return apiError(error, "Unable to load your venue claim.");
  }
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Venue access codes are redeemed directly during venue sign up.",
      signupUrl: "/?venueSignup=1",
    },
    { status: 410 },
  );
}
