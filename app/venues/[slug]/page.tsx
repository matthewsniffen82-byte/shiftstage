import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { getActiveClubDealForVenue } from "@/src/lib/dancr/deals";
import { getVenueProfile } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { DirectionsLink } from "./DirectionsLink";
import { VenueProfileActions } from "./VenueProfileActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

type VenueShift = {
  id: string;
  dancer_profiles?: { slug?: string; stage_name?: string; status?: string } | Array<{ slug?: string; stage_name?: string; status?: string }>;
  starts_at: string;
  ends_at: string;
};

export default async function VenuePublicPage({ params }: PageProps) {
  const { slug } = await params;
  const client = createAdminSupabaseClient();
  const venue = await getVenueProfile(client, slug);
  if (!venue) notFound();
  const activeDeal = await getActiveClubDealForVenue(client, venue.id);

  const { data, error } = await client
    .from("shifts")
    .select("id, starts_at, ends_at, dancer_profiles(slug, stage_name, status)")
    .eq("venue_id", venue.id)
    .eq("status", "posted")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  if (error) throw error;

  const shifts = ((data || []) as VenueShift[])
    .map((shift) => {
      const dancer = Array.isArray(shift.dancer_profiles) ? shift.dancer_profiles[0] : shift.dancer_profiles;
      return { ...shift, dancer };
    })
    .filter((shift) => shift.dancer?.status === "approved");

  return (
    <main className="public-profile-shell">
      <VenueProfileStyles />
      <nav className="public-nav">
        <Link href="/">Dancr</Link>
        <span>{venue.city}</span>
      </nav>
      <section className="venue-hero">
        <div className="venue-mark">{initials(venue.name)}</div>
        <div className="public-copy">
          <span className="eyebrow">Verified venue</span>
          <h1>{venue.name}</h1>
          <p>
            {venue.city}
            {venue.state ? `, ${venue.state}` : ""} nightlife schedule with approved dancer shifts.
          </p>
          {activeDeal ? (
            <section className="deal-section">
              <ClubDealCard deal={activeDeal} venueId={venue.id} sourceType="club_page" />
            </section>
          ) : null}
          <div className="public-actions">
            <Link href={`/tonight?city=${encodeURIComponent(venue.city)}`}>Now in {venue.city}</Link>
            {venue.address ? <DirectionsLink address={venue.address} venueId={venue.id} /> : null}
          </div>
          <VenueProfileActions venueId={venue.id} />
        </div>
      </section>
      <section className="public-grid">
        <article className="public-panel">
          <h2>Upcoming shifts</h2>
          {shifts.length ? (
            <div className="shift-list">
              {shifts.map((shift) => (
                <Link className="shift-row" href={`/dancers/${shift.dancer?.slug}`} key={shift.id}>
                  <strong>{shift.dancer?.stage_name}</strong>
                  <span>{formatShift(shift.starts_at)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No upcoming posted shifts.</p>
          )}
        </article>
        <article className="public-panel">
          <h2>Venue</h2>
          <dl className="fact-list">
            <div>
              <dt>City</dt>
              <dd>{venue.city}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{venue.state || "Pending"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{venue.address || "Address pending"}</dd>
            </div>
            <div>
              <dt>Hours</dt>
              <dd>{venue.hoursLabel || "Hours pending"}</dd>
            </div>
          </dl>
        </article>
      </section>
      {venue.address ? (
        <section className="map-panel" aria-label={`${venue.name} map preview`}>
          <iframe
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`/api/public/maps/embed?address=${encodeURIComponent(venue.address)}`}
            title={`${venue.name} map preview`}
          />
        </section>
      ) : null}
    </main>
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

function formatShift(startsAt: string) {
  const start = new Date(startsAt);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
  }).format(start);

  return `Scheduled ${date}`;
}

function VenueProfileStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .public-profile-shell { min-height: 100vh; padding: 22px clamp(18px, 4vw, 56px) 56px; background: radial-gradient(circle at 78% 8%, rgba(34,199,255,.18), transparent 28rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.26), transparent 24rem), linear-gradient(180deg, #090911, #050507 62%); }
      .public-nav { display: flex; justify-content: space-between; align-items: center; max-width: 1120px; margin: 0 auto 28px; color: #b9accd; font-size: 14px; }
      .public-nav a { color: #fff; text-decoration: none; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .venue-hero { max-width: 1120px; margin: 0 auto; min-height: min(62vh, 560px); display: grid; grid-template-columns: minmax(220px, 380px) minmax(0, 1fr); gap: clamp(24px, 5vw, 56px); align-items: center; }
      .venue-mark { min-height: 360px; border-radius: 8px; display: grid; place-items: center; font-size: clamp(56px, 9vw, 110px); font-weight: 950; background: radial-gradient(circle at 50% 48%, rgba(34,199,255,.22), transparent 34%), linear-gradient(135deg, rgba(139,92,246,.52), rgba(236,72,153,.2)); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 30px 80px rgba(0,0,0,.45); }
      .public-copy { display: grid; gap: 18px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(42px, 7vw, 88px); line-height: .94; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .public-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
      .public-actions a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border-radius: 999px; color: #fff; text-decoration: none; font-weight: 850; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(135deg, rgba(139,92,246,.38), rgba(34,199,255,.16)); }
      .directions-link { background: linear-gradient(135deg, rgba(34,199,255,.28), rgba(16,185,129,.14)) !important; }
      .live-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 2px; align-items: center; }
      .live-actions button, .live-actions a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; font-weight: 850; border: 1px solid rgba(148,229,255,.24); background: rgba(148,229,255,.08); cursor: pointer; font: inherit; }
      .live-actions span { color: #94e5ff; font-size: 13px; font-weight: 850; }
      .deal-section { width: 100%; margin: 4px 0 0; }
      .club-deal-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 300px); gap: 18px; align-items: center; border: 1px solid rgba(139,92,246,.28); background: rgba(8,8,13,.9); border-radius: 8px; padding: 18px; box-shadow: 0 22px 70px rgba(0,0,0,.38); }
      .club-deal-copy { display: grid; gap: 9px; }
      .club-deal-copy h2 { margin: 0; font-size: 24px; }
      .club-deal-copy small, .club-deal-action em, .deal-qr-frame span { color: #b9accd; font-size: 13px; line-height: 1.45; font-style: normal; font-weight: 800; }
      .club-deal-action { display: grid; gap: 10px; justify-items: stretch; }
      .club-deal-action button { min-height: 46px; border: 0; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #6d28d9, #22c7ff); font: inherit; font-weight: 950; cursor: pointer; }
      .club-deal-action button:disabled { opacity: .7; cursor: wait; }
      .deal-qr-frame { display: grid; justify-items: center; gap: 8px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: #050507; padding: 12px; }
      .deal-qr-frame img { width: min(170px, 100%); aspect-ratio: 1; border-radius: 6px; }
      .public-grid { max-width: 1120px; margin: 34px auto 0; display: grid; grid-template-columns: 1.2fr .8fr; gap: 18px; }
      .public-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; padding: 22px; }
      h2 { margin: 0 0 16px; font-size: 20px; }
      .shift-list { display: grid; gap: 10px; }
      .shift-row { display: flex; justify-content: space-between; gap: 14px; color: #f7f2ff; text-decoration: none; padding: 14px; border-radius: 8px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
      .shift-row span, .muted { color: #b9accd; }
      .fact-list { display: grid; gap: 12px; margin: 0; }
      .fact-list div { display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 12px; }
      dt { color: #b9accd; } dd { margin: 0; font-weight: 850; }
      .map-panel { max-width: 1120px; margin: 18px auto 0; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); min-height: 320px; }
      .map-panel iframe { display: block; width: 100%; min-height: 320px; border: 0; }
      @media (max-width: 760px) { .venue-hero, .public-grid, .club-deal-card { grid-template-columns: 1fr; } .venue-mark { min-height: 280px; } .shift-row, .fact-list div { flex-direction: column; } }
    `}</style>
  );
}
