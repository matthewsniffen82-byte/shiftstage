import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { requireVenueAccess } from "@/src/lib/dancr/venue-access";
import { getActiveClubDealById } from "@/src/lib/dancr/deals";
import { getVenueById } from "@/src/lib/dancr/venue";
import { getClubShuttleRecipientIds } from "@/src/lib/dancr/club-shuttle-requests";
import { toPublicClubDeal } from "@/src/lib/dancr/public-club-deal";
import { formatPublicVenueAddress } from "@/src/lib/dancr/uber";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.accountState !== "active" || !["admin", "venue"].includes(account.role)) {
      throw new PublicApiError("FORBIDDEN", "Sign in as the club manager or a MyDancr administrator to preview this offer.", 403);
    }
    const { dealId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId)) {
      throw new PublicApiError("NOT_FOUND", "This offer is unavailable.", 404);
    }
    const admin = createAdminSupabaseClient();
    let allowedVenueId: string | null = null;
    if (account.role === "admin") await requireAdmin(client, user.id);
    else allowedVenueId = (await requireVenueAccess(admin, user.id, "view_dashboard")).venueId;
    const deal = await getActiveClubDealById(admin, dealId);
    if (!deal || (allowedVenueId && allowedVenueId !== deal.venueId)) {
      throw new PublicApiError("NOT_FOUND", "This offer is unavailable for your account.", 404);
    }
    const profile = await getVenueById(admin, deal.venueId);
    const shuttleAvailable = profile.transportEnabled && (await getClubShuttleRecipientIds(admin, deal.venueId, profile.ownerUserId)).length > 0;
    const query = new URLSearchParams({ city: profile.city, venue: profile.slug, venue_id: profile.id, venue_preview: "1", preview_source: account.role });
    return NextResponse.json({ ok: true, session, deal: toPublicClubDeal(deal), shuttleAvailable,
      venue: { id: profile.id, name: profile.name, slug: profile.slug, address: formatPublicVenueAddress(profile), logoImageUrl: profile.logoImageUrl },
      returnHref: `/?${query}`,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) { return apiError(error, "Unable to load this free-entry preview."); }
}
