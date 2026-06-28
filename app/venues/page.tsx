import Link from "next/link";
import { formatVenueHours } from "@/src/lib/dancr/public";
import type { VenueSummary } from "@/src/lib/dancr/types";
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
          <Link href="/account">Account</Link>
        </div>
      </nav>

      <header className="page-hero">
        <span className="eyebrow">{city}</span>
        <h1>Verified venues</h1>
        <p>Active clubs with public venue pages, schedule details, maps, and directions.</p>
      </header>

      <section className="venue-grid" aria-label="Verified venues">
        {venues.map((venue) => (
          <Link className="venue-card" href={`/venues/${venue.slug}`} key={venue.id}>
            <span className="venue-mark">{initials(venue.name)}</span>
            <strong>{venue.name}</strong>
            <small>{venue.address || `${venue.city}${venue.state ? `, ${venue.state}` : ""}`}</small>
            <em>{venue.hoursLabel || "Hours pending"}</em>
          </Link>
        ))}
        {!venues.length ? (
          <div className="empty-state">
            <strong>No active venues yet.</strong>
            <span>Admin-created active venues will appear here automatically.</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

async function getActiveVenues(city: string): Promise<VenueSummary[]> {
  const { data, error } = await createAdminSupabaseClient()
    .from("venues")
    .select("id, slug, name, city, state, address, opens_at, closes_at")
    .eq("is_active", true)
    .eq("city", city)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data || []).map((venue) => ({
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    city: venue.city,
    state: venue.state,
    address: venue.address,
    hoursLabel: formatVenueHours(venue.opens_at, venue.closes_at),
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
      .venue-grid { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .venue-card { min-height: 260px; display: grid; align-content: end; gap: 10px; padding: 18px; color: #f7f2ff; text-decoration: none; border: 1px solid rgba(139,92,246,.24); background: radial-gradient(circle at 50% 30%, rgba(34,199,255,.18), transparent 36%), linear-gradient(135deg, rgba(139,92,246,.26), rgba(12,12,18,.88)); border-radius: 8px; }
      .venue-mark { width: 70px; height: 70px; display: grid; place-items: center; border-radius: 8px; background: rgba(255,255,255,.08); color: #94e5ff; font-size: 24px; font-weight: 950; }
      .venue-card strong { font-size: 26px; line-height: 1; overflow-wrap: anywhere; }
      .venue-card small, .empty-state span { color: #b9accd; line-height: 1.4; }
      .venue-card em { color: #94e5ff; font-style: normal; font-weight: 900; }
      .empty-state { grid-column: 1 / -1; min-height: 240px; display: grid; place-items: center; align-content: center; gap: 12px; text-align: center; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; padding: 24px; }
      .empty-state strong { font-size: 24px; }
      @media (max-width: 860px) { .venue-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } .venue-grid { grid-template-columns: 1fr; } h1 { font-size: 42px; } }
    `}</style>
  );
}
