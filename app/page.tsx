import Link from "next/link";
import { getApprovedDancersByCity, getTonightShifts, formatVenueHours } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CITY = "Las Vegas";

export default async function HomePage() {
  const [dancers, workingNow, venues] = await Promise.all([
    safeHomeLoad("approved dancers", () => getApprovedDancersByCity(createAdminSupabaseClient(), DEFAULT_CITY), []),
    safeHomeLoad("working now", () => getTonightShifts(createAdminSupabaseClient(), DEFAULT_CITY), []),
    safeHomeLoad("active venues", () => getActiveVenues(DEFAULT_CITY), []),
  ]);

  return (
    <main className="home-shell">
      <HomeStyles />
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href="/tonight">Now</Link>
          <Link href="/dancers">Dancers</Link>
          <Link href="/venues">Venues</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>

      <header className="home-hero">
        <span className="eyebrow">Live in {DEFAULT_CITY}</span>
        <h1>Find verified dancers working tonight.</h1>
        <p>Dancr now runs from the live app and database: approved profiles, venue schedules, check-ins, notifications, approvals, and account dashboards.</p>
        <div className="hero-actions">
          <Link href="/tonight">See who is working now</Link>
          <Link href="/dancers">Browse dancers</Link>
        </div>
      </header>

      <section className="live-grid" aria-label="Live Dancr overview">
        <LiveStat label="Working now" value={String(workingNow.length)} href="/tonight" />
        <LiveStat label="Approved dancers" value={String(dancers.length)} href="/dancers" />
        <LiveStat label="Active venues" value={String(venues.length)} href="/venues" />
      </section>

      <section className="section-band" aria-label="Working now preview">
        <div className="section-head">
          <span className="eyebrow">Now</span>
          <h2>Working now</h2>
          <Link href="/tonight">View all</Link>
        </div>
        <div className="card-grid">
          {workingNow.slice(0, 4).map((dancer) => (
            <Link className="profile-card" href={`/dancers/${dancer.slug}`} key={dancer.id}>
              <div className="photo" style={dancer.primaryPhotoUrl ? { backgroundImage: `url(${dancer.primaryPhotoUrl})` } : undefined}>
                {!dancer.primaryPhotoUrl ? <span>{initials(dancer.stageName)}</span> : null}
              </div>
              <strong>{dancer.stageName}</strong>
              <small>{dancer.venueName ? `${dancer.venueName} / ${dancer.shiftLabel || "Now"}` : "Checked in"}</small>
            </Link>
          ))}
          {!workingNow.length ? <EmptyCard title="No active check-ins" body="Posted shifts will appear here once dancers check in at their venue." /> : null}
        </div>
      </section>

      <section className="section-band" aria-label="Venues preview">
        <div className="section-head">
          <span className="eyebrow">Venues</span>
          <h2>Active venues</h2>
          <Link href="/venues">View all</Link>
        </div>
        <div className="venue-list">
          {venues.slice(0, 6).map((venue) => (
            <Link className="venue-row" href={`/venues/${venue.slug}`} key={venue.id}>
              <strong>{venue.name}</strong>
              <span>{venue.address || `${venue.city}${venue.state ? `, ${venue.state}` : ""}`}</span>
              <small>{venue.hoursLabel || "Hours pending"}</small>
            </Link>
          ))}
          {!venues.length ? <EmptyCard title="No active venues" body="Admin-created active venues will appear here from Supabase." /> : null}
        </div>
      </section>
    </main>
  );
}

async function getActiveVenues(city: string) {
  const { data, error } = await createAdminSupabaseClient()
    .from("venues")
    .select("id, slug, name, city, state, address, latitude, longitude, opens_at, closes_at")
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
    latitude: venue.latitude,
    longitude: venue.longitude,
    hoursLabel: formatVenueHours(venue.opens_at, venue.closes_at),
  }));
}

async function safeHomeLoad<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    console.error(`[home] Unable to load ${label}`, toLogSafeError(error));
    return fallback;
  }
}

function toLogSafeError(error: unknown) {
  if (!error || typeof error !== "object") return { message: String(error) };
  const record = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };

  return {
    message: typeof record.message === "string" ? record.message : "Unknown error",
    code: typeof record.code === "string" ? record.code : undefined,
    details: typeof record.details === "string" ? record.details : undefined,
    hint: typeof record.hint === "string" ? record.hint : undefined,
  };
}

function LiveStat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link className="live-stat" href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
    </Link>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-card">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
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
      .home-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 64px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.2), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav, .home-hero, .live-grid, .section-band { max-width: 1180px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 46px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links, .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .nav-links { justify-content: flex-end; }
      .nav-links a, .hero-actions a, .section-head a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .home-hero { min-height: 48vh; display: grid; align-content: center; gap: 18px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1, h2, p { margin: 0; }
      h1 { max-width: 840px; font-size: clamp(46px, 8vw, 94px); line-height: .92; letter-spacing: 0; }
      h2 { font-size: clamp(28px, 5vw, 48px); line-height: 1; }
      p { color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 66ch; }
      .live-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
      .live-stat { min-height: 118px; display: grid; align-content: center; gap: 8px; padding: 18px; color: #f7f2ff; text-decoration: none; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; }
      .live-stat span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .live-stat strong { font-size: 42px; line-height: 1; }
      .section-band { padding-top: 30px; display: grid; gap: 14px; }
      .section-head { display: grid; grid-template-columns: 1fr auto; gap: 8px 14px; align-items: end; }
      .section-head .eyebrow { grid-column: 1 / -1; }
      .card-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .profile-card, .empty-card, .venue-row { color: #f7f2ff; text-decoration: none; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; }
      .profile-card { min-width: 0; padding: 12px; display: grid; gap: 10px; }
      .photo { aspect-ratio: 3 / 4; border-radius: 8px; background: linear-gradient(135deg, rgba(34,199,255,.2), rgba(139,92,246,.36)); background-size: cover; background-position: center; display: grid; place-items: center; font-size: 28px; font-weight: 950; }
      .profile-card strong { font-size: 20px; overflow-wrap: anywhere; }
      .profile-card small, .empty-card span, .venue-row span, .venue-row small { color: #b9accd; line-height: 1.4; }
      .empty-card { min-height: 160px; padding: 18px; display: grid; place-items: center; align-content: center; gap: 8px; text-align: center; }
      .venue-list { display: grid; gap: 10px; }
      .venue-row { min-height: 72px; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.4fr) auto; gap: 12px; align-items: center; padding: 14px; }
      .venue-row strong, .venue-row span { overflow-wrap: anywhere; }
      .venue-row small { color: #94e5ff; font-weight: 850; }
      @media (max-width: 860px) { .live-grid, .card-grid, .venue-row { grid-template-columns: 1fr; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 42px; } .section-head { grid-template-columns: 1fr; } }
    `}</style>
  );
}
