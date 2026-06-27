import Link from "next/link";
import { getApprovedDancersByCity } from "@/src/lib/dancr/public";
import type { DancerCard } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TrendingPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function TrendingPage({ searchParams }: TrendingPageProps) {
  const params = await searchParams;
  const city = params.city || "Las Vegas";
  const dancers = await getApprovedDancersByCity(createAdminSupabaseClient(), city);
  const trending = dancers
    .filter((dancer) => dancer.currentRank)
    .sort((a, b) => (a.currentRank || 9999) - (b.currentRank || 9999));

  return (
    <main className="trending-shell">
      <TrendingStyles />
      <nav className="top-nav">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Tonight</Link>
          <Link href={`/dancers?city=${encodeURIComponent(city)}`}>Dancers</Link>
          <Link href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link>
        </div>
      </nav>

      <header className="page-hero">
        <span className="eyebrow">{city}</span>
        <h1>Trending now</h1>
        <p>City rankings calculated from live profile views, schedule views, follows, favorites, going signals, directions, notifications, and social clicks.</p>
      </header>

      <section className="ranking-list" aria-label="Trending dancers">
        {trending.map((dancer) => (
          <TrendingRow dancer={dancer} key={dancer.id} />
        ))}
        {!trending.length ? (
          <div className="empty-state">
            <strong>No rankings yet.</strong>
            <span>Admin ranking recalculation will publish the first live trending list.</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function TrendingRow({ dancer }: { dancer: DancerCard }) {
  return (
    <Link className="ranking-row" href={`/dancers/${dancer.slug}`}>
      <span className={dancer.currentRank === 1 ? "rank rank-one" : "rank"}>#{dancer.currentRank}</span>
      <span className="avatar" style={dancer.primaryPhotoUrl ? { backgroundImage: `url(${dancer.primaryPhotoUrl})` } : undefined}>
        {!dancer.primaryPhotoUrl ? initials(dancer.stageName) : ""}
      </span>
      <span className="identity">
        <strong>{dancer.stageName}</strong>
        <small>{dancer.venueName ? `${dancer.venueName} · ${dancer.shiftLabel || "Schedule posted"}` : "Approved profile"}</small>
      </span>
      <em>{dancer.shiftStartsAt ? "Scheduled" : "Profile live"}</em>
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

function TrendingStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .trending-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 4%, rgba(217,173,79,.18), transparent 22rem), radial-gradient(circle at 12% 14%, rgba(139,92,246,.26), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav { max-width: 1180px; margin: 0 auto 30px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .page-hero { max-width: 1180px; margin: 0 auto 26px; display: grid; gap: 14px; }
      .eyebrow { color: #f7d37c; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(46px, 8vw, 90px); line-height: .92; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 68ch; }
      .ranking-list { max-width: 1180px; margin: 0 auto; display: grid; gap: 10px; }
      .ranking-row { min-height: 88px; display: grid; grid-template-columns: 76px 58px minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px; color: #f7f2ff; text-decoration: none; border: 1px solid rgba(217,173,79,.2); background: rgba(12,12,18,.82); border-radius: 8px; }
      .rank { width: 60px; height: 60px; display: grid; place-items: center; border-radius: 8px; background: rgba(217,173,79,.12); color: #f7d37c; font-size: 20px; font-weight: 950; }
      .rank-one { color: #050507; background: linear-gradient(135deg, #f7d37c, #35d8ff); }
      .avatar { width: 58px; height: 58px; border-radius: 8px; display: grid; place-items: center; background: linear-gradient(135deg, rgba(34,199,255,.2), rgba(139,92,246,.36)); background-size: cover; background-position: center; font-size: 14px; font-weight: 950; }
      .identity { display: grid; gap: 5px; min-width: 0; }
      .identity strong { font-size: 22px; overflow-wrap: anywhere; }
      .identity small, .empty-state span { color: #b9accd; line-height: 1.4; }
      .ranking-row em { color: #94e5ff; font-style: normal; font-weight: 900; white-space: nowrap; }
      .empty-state { min-height: 240px; display: grid; place-items: center; align-content: center; gap: 12px; text-align: center; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; padding: 24px; }
      .empty-state strong { font-size: 24px; }
      @media (max-width: 680px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } .ranking-row { grid-template-columns: 58px 48px minmax(0, 1fr); } .ranking-row em { grid-column: 3; } .rank { width: 52px; height: 52px; font-size: 17px; } .avatar { width: 48px; height: 48px; } h1 { font-size: 42px; } }
    `}</style>
  );
}
