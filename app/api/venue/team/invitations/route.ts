import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { redeemVenueTeamInvitation, resolveVenueTeamInvitation } from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const invitation = await resolveVenueTeamInvitation(createAdminSupabaseClient(), token);
    return noStore({ ok: true, invitation });
  } catch (error) {
    return apiError(error, "Unable to open this venue team invitation.", 400);
  }
}

export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const admin = createAdminSupabaseClient();
    const account = await getAccountByUserId(admin, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return noStore({ ok: false, error: "Sign in with an active venue account." }, 403);
    }
    const email = String(account.email || user.email || "").trim().toLowerCase();
    const result = await redeemVenueTeamInvitation(admin, {
      token: String(body?.token || ""),
      userId: user.id,
      email,
    });
    return noStore({
      ok: true,
      venue: result.invitation.venue,
      role: result.invitation.role,
      session: session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to accept this venue team invitation.", 400);
  }
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
