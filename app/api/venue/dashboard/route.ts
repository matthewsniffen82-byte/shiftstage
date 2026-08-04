import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getVenueDashboard } from "@/src/lib/dancr/venue";
import { getLatestVenueOwnershipClaim } from "@/src/lib/dancr/venue-claims";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active venue account required." }, { status: 403 });
    }

    const admin = createAdminSupabaseClient();
    const claim = await getLatestVenueOwnershipClaim(admin, user.id);
    if (claim?.status === "pending" || claim?.status === "rejected") {
      return NextResponse.json({ ok: true, profile: null, claim });
    }

    const dashboard = await getVenueDashboard(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (error) {
    return apiError(error, "Unable to load venue dashboard.");
  }
}
