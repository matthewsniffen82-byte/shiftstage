import { NextResponse } from "next/server";
import { PublicApiError, resolveApiError } from "@/src/lib/api-error-policy";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { INTERNAL_HEADERS, isInternalUuid } from "@/src/lib/dancr/internal-roster";
import { createInternalGrant, internalGrantCookie } from "@/src/lib/dancr/internal-tap-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user, session } = await createRequestSupabaseContext(request, { role: "venue" });
    const admin = createAdminSupabaseClient();
    const access = await requireVenueAccess(admin, user.id, "view_roster");
    const venue = await admin.from("venues").select("id").eq("id", access.venueId).eq("is_active", true).maybeSingle();
    if (venue.error) throw venue.error;
    if (!venue.data) throw new PublicApiError("NOT_FOUND", "Your club’s live internal page is unavailable.", 404);

    // Open one existing live table page; NFC programming stays in Admin.
    const link = await admin.from("internal_roster_links").select("id,token")
      .eq("venue_id", access.venueId).eq("kind", "table").eq("active", true)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1).maybeSingle();
    if (link.error) throw link.error;
    if (!isInternalUuid(link.data?.token)) {
      throw new PublicApiError("NOT_FOUND", "Your club has no active table page yet. Ask MyDancr to set up its table NFC stickers.", 404);
    }
    const issued = createInternalGrant({ link: link.data.id, token: link.data.token, tag: null, generation: null, actor: user.id });
    const response = NextResponse.json({ ok: true, href: `/internal/club/${link.data.token}`, session }, { headers: INTERNAL_HEADERS });
    response.headers.append("set-cookie", internalGrantCookie(link.data.token, issued.value, new URL(request.url).protocol === "https:"));
    return response;
  } catch (error) {
    const resolved = resolveApiError(error, "Unable to open your club’s live internal page.");
    return NextResponse.json(resolved.body, { status: resolved.status, headers: INTERNAL_HEADERS });
  }
}
