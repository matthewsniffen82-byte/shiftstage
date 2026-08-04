import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import VenueClaimForm from "./VenueClaimForm";
import styles from "./VenueClaim.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function VenueClaimPage({ params }: PageProps) {
  const { slug } = await params;
  const { data: venue, error } = await createAdminSupabaseClient()
    .from("venues")
    .select("id, slug, name, city, state, address, owner_user_id, is_active")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!venue) notFound();

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <Link className={styles.brand} href={`/?city=${encodeURIComponent(venue.city)}&venue=${encodeURIComponent(venue.slug)}`}>
          mydancr
        </Link>
        <Link className={styles.back} href={`/?city=${encodeURIComponent(venue.city)}&venue=${encodeURIComponent(venue.slug)}`}>
          Back to venue
        </Link>
      </header>

      <section className={styles.shell}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Venue ownership</span>
          <h1>Claim {venue.name}</h1>
          <p>
            Connect a verified venue account to the existing live card. The public card stays online while MyDancr reviews the request.
          </p>
          <dl className={styles.venueFacts}>
            <div><dt>Venue</dt><dd>{venue.name}</dd></div>
            <div><dt>Location</dt><dd>{[venue.city, venue.state].filter(Boolean).join(", ")}</dd></div>
            {venue.address ? <div><dt>Address</dt><dd>{venue.address}</dd></div> : null}
          </dl>
        </div>

        <VenueClaimForm
          venue={{
            id: venue.id,
            slug: venue.slug,
            name: venue.name,
            city: venue.city,
            isClaimable: !venue.owner_user_id,
          }}
        />
      </section>
    </main>
  );
}
