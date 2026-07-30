import { notFound, permanentRedirect } from "next/navigation";
import { getVenueProfile } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function VenuePublicPage({ params }: PageProps) {
  const { slug } = await params;
  const venue = await getVenueProfile(createAdminSupabaseClient(), slug);
  if (!venue) notFound();

  const query = new URLSearchParams({
    city: venue.city,
    venue: venue.slug,
  });
  permanentRedirect(`/?${query.toString()}`);
}
