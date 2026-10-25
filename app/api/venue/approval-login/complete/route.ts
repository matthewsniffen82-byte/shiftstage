import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { completeVenueApprovalLogin, VENUE_APPROVAL_HEADERS } from "@/src/lib/dancr/venue-approval-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    await completeVenueApprovalLogin(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, session }, { headers: VENUE_APPROVAL_HEADERS });
  } catch (error) {
    const response = apiError(error, "Unable to finish securing your dashboard sign-in.");
    for (const [key, value] of Object.entries(VENUE_APPROVAL_HEADERS)) response.headers.set(key, value);
    return response;
  }
}
