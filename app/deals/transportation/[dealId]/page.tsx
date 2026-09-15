import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getActiveClubDealById } from "@/src/lib/dancr/deals";
import { toPublicClubDeal } from "@/src/lib/dancr/public-club-deal";
import { getClubShuttleRecipientIds } from "@/src/lib/dancr/club-shuttle-requests";
import { formatPublicVenueAddress } from "@/src/lib/dancr/uber";
import TransportationClient from "./TransportationClient";

export const dynamic = "force-dynamic";

export default async function TransportationPage({ params, searchParams }: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId)) notFound();
  const admin = createAdminSupabaseClient();
  const deal = await getActiveClubDealById(admin, dealId);
  if (!deal) notFound();
  const { data: venue, error } = await admin.from("venues").select("name, slug, phone, owner_user_id, address, city, state, club_pickup_available")
    .eq("id", deal.venueId).eq("is_active", true).eq("page_review_status", "published")
    .not("published_at", "is", null).maybeSingle();
  if (error) throw error;
  if (!venue) notFound();
  const shuttleAvailable = (await getClubShuttleRecipientIds(admin, deal.venueId, venue.owner_user_id)).length > 0;
  const query = await searchParams;
  const read = (key: string, max: number) => typeof query[key] === "string" ? query[key].slice(0, max) : "";
  return <TransportationClient deal={toPublicClubDeal(deal)} venue={{ id: deal.venueId, name: venue.name, slug: venue.slug, address: formatPublicVenueAddress(venue) }} shuttleAvailable={shuttleAvailable}
    pickupAvailable={venue.club_pickup_available === true}
    sourceType={query.sourceType === "dancer_profile" ? "dancer_profile" : "club_page"}
    dancerId={read("dancerId", 36)} attributionToken={read("attributionToken", 2048)} />;
}
