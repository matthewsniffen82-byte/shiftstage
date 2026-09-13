import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getClubShuttleRecipientIds } from "@/src/lib/dancr/club-shuttle-requests";
import TransportationClient from "@/app/deals/transportation/[dealId]/TransportationClient";
import { getActiveClubDealForVenue, getActiveClubDealByIdForVenue } from "@/src/lib/dancr/deals";
import { toPublicClubDeal } from "@/src/lib/dancr/public-club-deal";

export const dynamic = "force-dynamic";

export default async function FreeRidePage({ params, searchParams }: {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { venueId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId)) notFound();
  const admin = createAdminSupabaseClient();
  const { data: venue, error } = await admin.from("venues").select("id, name, slug, owner_user_id")
    .eq("id", venueId).eq("is_active", true).eq("page_review_status", "published")
    .not("published_at", "is", null).maybeSingle();
  if (error) throw error;
  if (!venue) notFound();
  const query = await searchParams;
  const read = (key: string, max: number) => typeof query[key] === "string" ? query[key].slice(0, max) : "";
  const requestedDealId = read("dealId", 36);
  if (requestedDealId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedDealId)) notFound();
  const deal = requestedDealId
    ? await getActiveClubDealByIdForVenue(admin, venue.id, requestedDealId)
    : await getActiveClubDealForVenue(admin, venue.id);
  if (requestedDealId && !deal) notFound();
  const shuttleAvailable = (await getClubShuttleRecipientIds(admin, venue.id, venue.owner_user_id)).length > 0;
  return <TransportationClient deal={deal ? toPublicClubDeal(deal) : undefined}
    venue={{ id: venue.id, name: venue.name, slug: venue.slug }} shuttleAvailable={shuttleAvailable}
    initialTransportation="club_shuttle"
    sourceType={requestedDealId && query.sourceType === "dancer_profile" ? "dancer_profile" : "club_page"}
    dancerId={read("dancerId", 36)} attributionToken={read("attributionToken", 2048)} />;
}
