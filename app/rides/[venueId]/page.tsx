import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getClubShuttleRecipientIds } from "@/src/lib/dancr/club-shuttle-requests";
import TransportationClient from "@/app/deals/transportation/[dealId]/TransportationClient";

export const dynamic = "force-dynamic";

export default async function FreeRidePage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(venueId)) notFound();
  const admin = createAdminSupabaseClient();
  const { data: venue, error } = await admin.from("venues").select("id, name, slug, owner_user_id")
    .eq("id", venueId).eq("is_active", true).eq("page_review_status", "published")
    .not("published_at", "is", null).maybeSingle();
  if (error) throw error;
  if (!venue) notFound();
  const shuttleAvailable = (await getClubShuttleRecipientIds(admin, venue.id, venue.owner_user_id)).length > 0;
  return <TransportationClient venue={{ id: venue.id, name: venue.name, slug: venue.slug }} shuttleAvailable={shuttleAvailable} />;
}
