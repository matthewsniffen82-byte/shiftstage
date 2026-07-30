import Link from "next/link";
import { getActiveClubDealsForVenues } from "@/src/lib/dancr/deals";
import { formatVenueHours } from "@/src/lib/dancr/public";
import type { ClubDeal, VenueSummary } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VenuesPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function VenuesPage({ searchParams }: VenuesPageProps) {
  const params = await searchParams;
  const city = params.city || "Las Vegas";
  const venues = await getActiveVenues(city);

  return (
    <main className="venues-shell">
      <VenuesStyles />
      <nav className="top-nav">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Now</Link>
          <Link href={`/dancers?city=${encodeURIComponent(city)}`}>Dancers</Link>
          <Link href={`/trending?city=${encodeURIComponent(city)}`}>Trending</Link>
          <Link href={`/tv?city=${encodeURIComponent(city)}`}>MyDancr TV</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>

      <header className="page-hero">
        <span className="eyebrow">{city}</span>
        <h1>Venues</h1>
        <p>Active clubs with public venue pages, schedule details, maps, and directions.</p>
      </header>

      <section className="venue-grid" aria-label="Venues">
        {venues.map((venue) => (
          <article className="venue-card" key={venue.id}>
            <Link
              className={`venue-card-main${venue.coverImageUrl ? " has-cover" : ""}`}
              href={`/venues/${encodeURIComponent(venue.slug)}`}
              style={venue.coverImageUrl ? {
                backgroundImage: `linear-gradient(180deg, rgba(5,5,9,.08), rgba(5,5,9,.14) 42%, rgba(5,5,9,.97) 100%), url("${venue.coverImageUrl}")`,
              } : undefined}
            >
              <span className="venue-card-kicker">Mydancr venue</span>
              <span className="venue-mark">{initials(venue.name)}</span>
              <span className="venue-card-copy">
                <strong>{venue.name}</strong>
                <small>{venue.address || `${venue.city}${venue.state ? `, ${venue.state}` : ""}`}</small>
                {venue.hoursLabel ? <em>{venue.hoursLabel}</em> : null}
              </span>
            </Link>
            <div className="venue-card-actions">
              <Link
                className="venue-card-profile"
                href={`/?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(venue.slug)}`}
              >
                View venue
              </Link>
              {venue.activeDeal ? (
                <Link
                  className="venue-card-deal"
                  href={`/?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(venue.slug)}#club-deal`}
                >
                  <span>Club Deal</span>
                  <strong>View deal</strong>
                </Link>
              ) : null}
            </div>
          </article>
        ))}
        {!venues.length ? (
          <div className="empty-state">
            <strong>No active venues yet.</strong>
            <span>Active venue accounts will appear here automatically.</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

async function getActiveVenues(city: string): Promise<Array<VenueSummary & { activeDeal: ClubDeal | null }>> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("venues")
    .select("id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at, cover_image_storage_path")
    .eq("is_active", true)
    .eq("city", city)
    .order("name", { ascending: true });

  if (error) throw error;
  const deals = await getActiveClubDealsForVenues(client, (data || []).map((venue) => venue.id));

  return (data || []).map((venue) => ({
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    city: venue.city,
    state: venue.state,
    address: venue.address,
    latitude: venue.latitude,
    longitude: venue.longitude,
    hoursLabel: formatVenueHours(venue.opens_at, venue.closes_at),
    coverImageUrl: venue.cover_image_storage_path
      ? client.storage.from("venue-cover-images").getPublicUrl(venue.cover_image_storage_path).data.publicUrl
      : null,
    activeDeal: deals.get(venue.id) || null,
  }));
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function VenuesStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .venues-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 80% 2%, rgba(34,199,255,.18), transparent 24rem), radial-gradient(circle at 12% 14%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav { max-width: 1180px; margin: 0 auto 30px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .page-hero { max-width: 1180px; margin: 0 auto 26px; display: grid; gap: 14px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(46px, 8vw, 90px); line-height: .92; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .venue-grid { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
      .venue-card { min-height: 430px; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; color: #f7f2ff; border: 1px solid rgba(139,92,246,.34); background: #07070b; border-radius: 20px; box-shadow: 0 20px 54px rgba(0,0,0,.38), 0 0 24px rgba(124,58,237,.1); }
      .venue-card-main { position: relative; min-height: 370px; display: grid; align-content: end; gap: 10px; padding: 18px; overflow: hidden; color: #f7f2ff; background: radial-gradient(circle at 72% 24%, rgba(34,199,255,.24), transparent 32%), radial-gradient(circle at 16% 72%, rgba(217,70,239,.28), transparent 38%), linear-gradient(145deg, #17102a, #07070b 70%); background-position: center; background-size: cover; text-decoration: none; }
      .venue-card-main::after { position: absolute; z-index: 0; inset: 0; content: ""; background: linear-gradient(180deg, rgba(0,0,0,.02), transparent 42%, rgba(0,0,0,.96)); pointer-events: none; }
      .venue-card-main > * { position: relative; z-index: 1; }
      .venue-card-kicker { position: absolute; top: 18px; left: 18px; color: rgba(255,255,255,.8); font-size: 9px; font-weight: 950; letter-spacing: .19em; text-transform: uppercase; text-shadow: 0 2px 12px rgba(0,0,0,.85); }
      .venue-mark { position: absolute; top: 14px; right: 14px; width: 46px; height: 46px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.24); border-radius: 14px; color: #fff; background: rgba(8,8,14,.54); box-shadow: 0 12px 28px rgba(0,0,0,.35); font-size: 14px; font-weight: 950; backdrop-filter: blur(14px); }
      .venue-card-copy { display: grid; gap: 7px; }
      .venue-card-copy > strong { font-size: 28px; line-height: 1; overflow-wrap: anywhere; text-shadow: 0 3px 16px rgba(0,0,0,.9); }
      .venue-card-main small, .empty-state span { color: #ddd6e8; line-height: 1.35; text-shadow: 0 2px 12px rgba(0,0,0,.92); }
      .venue-card-main em { width: fit-content; padding: 6px 9px; border: 1px solid rgba(126,234,255,.36); border-radius: 999px; color: #b9f3ff; background: rgba(9,67,82,.58); font-size: 11px; font-style: normal; font-weight: 900; backdrop-filter: blur(12px); }
      .venue-card-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid rgba(126,234,255,.16); background: rgba(7,7,12,.96); }
      .venue-card-actions > a:only-child { grid-column: 1 / -1; }
      .venue-card-profile { min-height: 58px; display: inline-flex; align-items: center; justify-content: center; padding: 0 16px; color: #fff; background: rgba(126,234,255,.07); font-size: 13px; font-weight: 950; text-decoration: none; }
      .venue-card-deal { display: grid; align-content: center; gap: 3px; min-height: 58px; padding: 9px 14px; color: #fff; background: linear-gradient(135deg, rgba(18,129,79,.9), rgba(7,92,77,.9)); text-decoration: none; }
      .venue-card-deal span { color: #91f7c0; font-size: 9px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .venue-card-deal strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
      .empty-state { grid-column: 1 / -1; min-height: 240px; display: grid; place-items: center; align-content: center; gap: 12px; text-align: center; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; padding: 24px; }
      .empty-state strong { font-size: 24px; }
      @media (max-width: 860px) { .venue-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } .venue-grid { grid-template-columns: 1fr; } h1 { font-size: 42px; } }
    `}</style>
  );
}
