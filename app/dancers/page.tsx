import Link from "next/link";
import { getApprovedDancersByCity } from "@/src/lib/dancr/public";
import type { DancerCard } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DancersPageProps = {
  searchParams: Promise<{ city?: string }>;
};

export default async function DancersPage({ searchParams }: DancersPageProps) {
  const params = await searchParams;
  const city = params.city || "Las Vegas";
  const dancers = await getApprovedDancersByCity(createAdminSupabaseClient(), city);
  const randomized = randomizeDancerGroups(dancers);

  return (
    <main className="directory-shell">
      <DancersStyles />
      <nav className="top-nav">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href={`/tonight?city=${encodeURIComponent(city)}`}>Now</Link>
          <Link href={`/venues?city=${encodeURIComponent(city)}`}>Venues</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>

      <header className="page-hero">
        <span className="eyebrow">{city}</span>
        <h1>Approved dancers</h1>
        <p>Verified public profiles with approved photos, socials, rankings, and venue-confirmed schedule details.</p>
      </header>

      <section className="dancer-directory" aria-label="Approved dancers">
        {randomized.map((dancer) => (
          <DancerDirectoryCard dancer={dancer} key={dancer.id} />
        ))}
        {!randomized.length ? (
          <div className="empty-state">
            <strong>No approved dancers yet.</strong>
            <span>As profiles pass review, they will appear here automatically.</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function randomizeDancerGroups(dancers: DancerCard[]) {
  const now = Date.now();
  const workingNow = dancers.filter((dancer) => isWorkingNow(dancer, now));
  const upcoming = dancers.filter((dancer) => !isWorkingNow(dancer, now) && dancer.shiftStartsAt);
  const noSchedule = dancers.filter((dancer) => !dancer.shiftStartsAt);
  return [...shuffle(workingNow), ...shuffle(upcoming), ...shuffle(noSchedule)];
}

function isWorkingNow(dancer: DancerCard, now: number) {
  if (!dancer.shiftStartsAt || !dancer.shiftEndsAt) return false;
  return new Date(dancer.shiftStartsAt).getTime() <= now && new Date(dancer.shiftEndsAt).getTime() >= now;
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function DancerDirectoryCard({ dancer }: { dancer: DancerCard }) {
  return (
    <Link className="directory-card" href={`/dancers/${dancer.slug}`}>
      <div className="photo" style={dancer.primaryPhotoUrl ? { backgroundImage: `url(${dancer.primaryPhotoUrl})` } : undefined}>
        {!dancer.primaryPhotoUrl ? <span>{initials(dancer.stageName)}</span> : null}
      </div>
      <div className="copy">
        <span>{dancer.currentRank ? `#${dancer.currentRank} Trending` : "Verified"}</span>
        <strong>{dancer.stageName}</strong>
        <small>{dancer.venueName ? `${dancer.venueName} · ${dancer.shiftLabel || "Schedule posted"}` : "No upcoming shift"}</small>
      </div>
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

function DancersStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .directory-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 80% 2%, rgba(139,92,246,.24), transparent 24rem), radial-gradient(circle at 12% 14%, rgba(34,199,255,.18), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav { max-width: 1180px; margin: 0 auto 30px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .page-hero { max-width: 1180px; margin: 0 auto 26px; display: grid; gap: 14px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(46px, 8vw, 90px); line-height: .92; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 62ch; }
      .dancer-directory { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .directory-card { min-width: 0; display: grid; color: #f7f2ff; text-decoration: none; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; overflow: hidden; }
      .photo { aspect-ratio: 3 / 4; background: linear-gradient(135deg, rgba(34,199,255,.2), rgba(139,92,246,.36)); background-size: cover; background-position: center; display: grid; place-items: center; font-size: 28px; font-weight: 950; }
      .copy { display: grid; gap: 6px; padding: 13px; }
      .copy span { color: #94e5ff; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; }
      .copy strong { font-size: 20px; overflow-wrap: anywhere; }
      .copy small, .empty-state span { color: #b9accd; line-height: 1.4; }
      .empty-state { grid-column: 1 / -1; min-height: 240px; display: grid; place-items: center; align-content: center; gap: 12px; text-align: center; border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; padding: 24px; }
      .empty-state strong { font-size: 24px; }
      @media (max-width: 860px) { .dancer-directory { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } .dancer-directory { grid-template-columns: 1fr; } h1 { font-size: 42px; } }
    `}</style>
  );
}
