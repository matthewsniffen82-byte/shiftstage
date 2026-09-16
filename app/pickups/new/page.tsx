import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getPickupVenue } from "@/src/lib/dancr/pickup-eligibility";
export const dynamic = "force-dynamic";
export default async function NewPickupPage({ searchParams }: { searchParams: Promise<{ venue?: string }> }) {
  const { venue: venueId } = await searchParams;
  let venue = null;
  try { if (venueId) venue = await getPickupVenue(createAdminSupabaseClient(), venueId); } catch { /* Fail closed without disclosing account data. */ }
  if (!venue) return <section className="pickup-card"><h1>Club Pickup unavailable</h1><p>This venue is not accepting pickup requests right now. Please choose another club.</p><Link href="/?view=venues">Browse clubs</Link></section>;
  redirect(`/rides/${encodeURIComponent(venue.id)}`);
}
