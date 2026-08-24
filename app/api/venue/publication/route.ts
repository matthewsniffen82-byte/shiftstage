import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireActiveVenueAccount } from "@/src/lib/dancr/auth";
import { reviewVenuePageForAccount } from "@/src/lib/dancr/venue";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { recordVenueActivity } from "@/src/lib/dancr/venue-team";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireActiveVenueAccount(client, user.id);
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "manage_profile");
    const body = await request.json().catch(() => null);
    const decision = body?.decision === "approved" || body?.decision === "changes_requested"
      ? body.decision
      : null;
    if (!decision) {
      return NextResponse.json({ ok: false, error: "Choose whether to approve the page or request changes." }, { status: 400 });
    }
    const result = await reviewVenuePageForAccount(admin, user.id, {
      decision,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    await recordVenueActivity(admin, {
      venueId: access.venueId,
      actorUserId: user.id,
      actorRole: access.role,
      action: decision === "approved" ? "profile.venue_page_approved_and_published" : "profile.venue_page_changes_requested",
      targetType: "venue",
      targetId: result.profile.id,
      summary: decision === "approved"
        ? "The venue approved its private MyDancr page and published it."
        : "The venue requested changes to its private MyDancr page.",
    });
    return NextResponse.json({
      ok: true,
      ...result,
      message: decision === "approved"
        ? "Page approved and published. Your venue is now live on MyDancr."
        : "Change request sent to MyDancr.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "Unable to record venue page review.", 400);
  }
}
