import Link from "next/link";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getPickupVenue } from "@/src/lib/dancr/pickup-eligibility";
import PickupRequestForm from "../PickupRequestForm";
export const dynamic = "force-dynamic";
export default async function NewPickupPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const { venue: venueId } = await searchParams;
  let venue = null;
  try { if (venueId) venue = await getPickupVenue(createAdminSupabaseClient(), venueId); } catch { /* Fail closed without disclosing account data. */ }
  if (!venue?.club_pickup_enabled) return <section className="pickup-card"><h1>Club Pickup unavailable</h1><p>This venue is not accepting pickup requests right now. Existing conversations remain in your pickup inbox.</p><Link href="/pickups">My pickup requests</Link><Link href="/?view=venues">Browse clubs</Link></section>;
  return <PickupRequestForm venue={venue} />;
}
