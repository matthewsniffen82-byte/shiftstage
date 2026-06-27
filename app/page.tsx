import Link from "next/link";
import { formatVenueHours, getApprovedDancersByCity, getTonightShifts } from "@/src/lib/dancr/public";
import type { DancerCard, VenueSummary } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const city = params.city || "Las Vegas";
  const client = createAdminSupabaseClient();
  const [tonight, dancers, venues] = await Promise.all([
    getTonightShifts(client, city),
    getApprovedDancersByCity(client, city),
    getActiveVenues(client, city),
  ]);
  const featured = tonight[0] || dancers[0] || null;

  return (
    <main className="home-shell">
      <HomeStyles />
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href={`/trending?city=${encodeURIComponent(city)}`}>Trending</Link>
          <Link href="/outputs/index.html">Full App</Link>
          <Link href="/outputs/index.html?auth=customer">Customer</Link>
          <Link href="/outputs/index.html?auth=dancer">Dancer</Link>
        </div>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">{city} tonight</span>
          <h1>Verified schedules, dancers, and venues.</h1>
          <p>
            See who is working tonight, open verified public profiles, and jump straight into venue details with live
            schedule data.
          </p>
          <div className="hero-actions">
            <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Tonight</Link>
            <Link href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link>
          </div>
        </div>
        <FeaturedDancer dancer={featured} />
      </section>

      <section className="section-grid" id="tonight">
        <div className="section-head">
          <div>
            <span className="eyebrow">Working now</span>
            <h2>Tonight</h2>
          </div>
          <span>{tonight.length} posted</span>
        </div>
        <div className="dancer-grid">
          {(tonight.length ? tonight : dancers.slice(0, 4)).map((dancer) => (
            <DancerTile dancer={dancer} key={dancer.id} />
          ))}
          {!tonight.length && !dancers.length ? <p className="empty">No approved dancers are live in this city yet.</p> : null}
        </div>
      </section>

      <section className="split-grid">
        <div className="section-grid">
          <div className="section-head">
            <div>
              <span className="eyebrow">Approved profiles</span>
              <h2><Link className="section-link" href={`/dancers?city=${encodeURIComponent(city)}`}>Dancers</Link></h2>
            </div>
            <span>{dancers.length} live</span>
          </div>
          <div className="compact-list">
            {dancers.slice(0, 8).map((dancer) => (
              <DancerRow dancer={dancer} key={dancer.id} />
            ))}
            {!dancers.length ? <p className="empty">No approved public profiles yet.</p> : null}
          </div>
        </div>

        <div className="section-grid" id="venues">
          <div className="section-head">
            <div>
              <span className="eyebrow">Verified clubs</span>
              <h2><Link className="section-link" href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link></h2>
            </div>
            <span>{venues.length} active</span>
          </div>
          <div className="compact-list">
            {venues.slice(0, 8).map((venue) => (
              <Link className="venue-row" href={`/venues/${venue.slug}`} key={venue.id}>
                <strong>{venue.name}</strong>
                <span>{venue.hoursLabel || venue.address || `${venue.city}${venue.state ? `, ${venue.state}` : ""}`}</span>
              </Link>
            ))}
            {!venues.length ? <p className="empty">No active venues are live in this city yet.</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

async function getActiveVenues(client: ReturnType<typeof createAdminSupabaseClient>, city: string): Promise<VenueSummary[]> {
  const { data, error } = await client
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

function FeaturedDancer({ dancer }: { dancer: DancerCard | null }) {
  if (!dancer) {
    return (
      <div className="featured empty-feature">
        <span>LV</span>
        <strong>Live profiles appear here as dancers are approved.</strong>
      </div>
    );
  }

  return (
    <Link
      className="featured"
      href={`/dancers/${dancer.slug}`}
      style={dancer.primaryPhotoUrl ? { backgroundImage: `url(${dancer.primaryPhotoUrl})` } : undefined}
    >
      <div>
        <span>{dancer.currentRank ? `#${dancer.currentRank} Trending` : "Verified"}</span>
        <strong>{dancer.stageName}</strong>
        <small>{dancer.venueName ? `${dancer.venueName} · ${dancer.shiftLabel || "Schedule posted"}` : "Profile live"}</small>
      </div>
    </Link>
  );
}

function DancerTile({ dancer }: { dancer: DancerCard }) {
  return (
    <Link className="dancer-tile" href={`/dancers/${dancer.slug}`}>
      <div className="tile-photo" style={dancer.primaryPhotoUrl ? { backgroundImage: `url(${dancer.primaryPhotoUrl})` } : undefined}>
        {!dancer.primaryPhotoUrl ? <span>{initials(dancer.stageName)}</span> : null}
      </div>
      <strong>{dancer.stageName}</strong>
      <span>{dancer.venueName ? `${dancer.venueName} · ${dancer.shiftLabel || "Posted"}` : "No upcoming shift"}</span>
    </Link>
  );
}

function DancerRow({ dancer }: { dancer: DancerCard }) {
  return (
    <Link className="dancer-row" href={`/dancers/${dancer.slug}`}>
      <span className="avatar" style={dancer.primaryPhotoUrl ? { backgroundImage: `url(${dancer.primaryPhotoUrl})` } : undefined}>
        {!dancer.primaryPhotoUrl ? initials(dancer.stageName) : ""}
      </span>
      <span>
        <strong>{dancer.stageName}</strong>
        <small>{dancer.venueName || "Approved profile"}</small>
      </span>
      <em>{dancer.currentRank ? `#${dancer.currentRank}` : "Live"}</em>
    </Link>
  );
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function HomeStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .home-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.18), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.28), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav { max-width: 1180px; margin: 0 auto 28px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a, .hero-actions a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .hero-grid { max-width: 1180px; margin: 0 auto; min-height: min(66vh, 620px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 420px); gap: clamp(24px, 5vw, 58px); align-items: stretch; }
      .hero-copy { display: grid; align-content: center; gap: 18px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; max-width: 760px; font-size: clamp(44px, 8vw, 94px); line-height: .92; letter-spacing: 0; }
      h2 { margin: 0; font-size: 28px; letter-spacing: 0; }
      .section-link { color: inherit; text-decoration: none; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 60ch; }
      .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
      .hero-actions a:first-child { background: linear-gradient(135deg, rgba(139,92,246,.42), rgba(34,199,255,.18)); }
      .featured { position: relative; min-height: 440px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,.1); background: linear-gradient(135deg, rgba(139,92,246,.5), rgba(236,72,153,.22)); background-size: cover; background-position: center; box-shadow: 0 30px 80px rgba(0,0,0,.45); color: #fff; text-decoration: none; display: grid; align-items: end; }
      .featured:before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 28%, rgba(5,5,7,.88)); }
      .featured div { position: relative; display: grid; gap: 8px; padding: 22px; }
      .featured span { color: #94e5ff; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .14em; }
      .featured strong { font-size: 36px; line-height: 1; }
      .featured small { color: #d8cfeb; font-size: 14px; line-height: 1.4; }
      .empty-feature { place-items: center; align-items: center; padding: 24px; text-align: center; }
      .empty-feature:before { display: none; }
      .empty-feature span { width: 96px; height: 96px; display: grid; place-items: center; border-radius: 50%; background: rgba(0,0,0,.28); font-size: 28px; }
      .empty-feature strong { max-width: 16ch; font-size: 24px; }
      .section-grid, .split-grid { max-width: 1180px; margin: 34px auto 0; }
      .section-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
      .section-head > span { color: #b9accd; font-weight: 850; }
      .dancer-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .dancer-tile, .dancer-row, .venue-row { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); color: #f7f2ff; text-decoration: none; border-radius: 8px; }
      .dancer-tile { min-width: 0; padding: 12px; display: grid; gap: 10px; }
      .tile-photo { aspect-ratio: 3 / 4; border-radius: 8px; background: linear-gradient(135deg, rgba(34,199,255,.2), rgba(139,92,246,.36)); background-size: cover; background-position: center; display: grid; place-items: center; font-size: 28px; font-weight: 950; }
      .dancer-tile strong { font-size: 18px; overflow-wrap: anywhere; }
      .dancer-tile span, .dancer-row small, .venue-row span, .empty { color: #b9accd; line-height: 1.4; }
      .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
      .split-grid .section-grid { margin: 0; }
      .compact-list { display: grid; gap: 10px; }
      .dancer-row { min-height: 72px; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px; }
      .avatar { width: 48px; height: 48px; border-radius: 8px; display: grid; place-items: center; background: linear-gradient(135deg, rgba(34,199,255,.2), rgba(139,92,246,.36)); background-size: cover; background-position: center; font-size: 13px; font-weight: 950; }
      .dancer-row > span:nth-child(2) { display: grid; gap: 3px; min-width: 0; }
      .dancer-row strong, .venue-row strong { overflow-wrap: anywhere; }
      .dancer-row em { color: #94e5ff; font-style: normal; font-weight: 900; }
      .venue-row { min-height: 70px; display: grid; gap: 5px; padding: 14px; }
      @media (max-width: 860px) { .hero-grid, .split-grid { grid-template-columns: 1fr; } .dancer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .featured { min-height: 340px; } }
      @media (max-width: 520px) { .top-nav, .section-head { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } .dancer-grid { grid-template-columns: 1fr; } h1 { font-size: 42px; } }
    `}</style>
  );
}
