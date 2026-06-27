import Link from "next/link";
import { notFound } from "next/navigation";
import { getDancerProfile } from "@/src/lib/dancr/public";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { DancerProfileActions } from "./DancerProfileActions";
import { ProfileViewTracker } from "./ProfileViewTracker";
import { SocialLinks } from "./SocialLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DancerPublicPage({ params }: PageProps) {
  const { slug } = await params;
  const profile = await getDancerProfile(createAdminSupabaseClient(), slug);
  if (!profile) notFound();

  const heroPhoto = profile.primaryPhotoUrl || profile.photos[0]?.imageUrl || "";
  const gallery = profile.photos.length ? profile.photos : heroPhoto ? [{ id: "primary", imageUrl: heroPhoto, isPrimary: true, sortOrder: 0 }] : [];

  return (
    <main className="public-profile-shell">
      <ProfileViewTracker dancerId={profile.id} hasSchedule={profile.upcomingShifts.length > 0} />
      <PublicProfileStyles />
      <nav className="public-nav">
        <Link href="/">Dancr</Link>
        <span>{profile.city}</span>
      </nav>
      <section className="public-hero dancer-hero">
        <div className="public-copy">
          <span className="eyebrow">Verified dancer</span>
          <h1>{profile.stageName}</h1>
          <p>{profile.bio || "Approved public profile with venue-confirmed schedule details."}</p>
          <div className="public-actions">
            <Link href={`/tonight?city=${encodeURIComponent(profile.city)}`}>Tonight in {profile.city}</Link>
            {profile.venueSlug ? <Link href={`/venues/${profile.venueSlug}`}>{profile.venueName || "Venue"}</Link> : null}
          </div>
          <DancerProfileActions
            dancerId={profile.id}
            shifts={profile.upcomingShifts.map((shift) => ({ id: shift.id, label: shortShiftLabel(shift.startsAt) }))}
          />
        </div>
        <div className="public-photo" style={heroPhoto ? { backgroundImage: `url(${heroPhoto})` } : undefined}>
          {!heroPhoto ? <span>{initials(profile.stageName)}</span> : null}
        </div>
      </section>
      <section className="public-grid">
        <article className="public-panel">
          <h2>Schedule</h2>
          {profile.upcomingShifts.length ? (
            <div className="shift-list">
              {profile.upcomingShifts.map((shift) => (
                <Link className="shift-row" href={`/venues/${shift.venueSlug}`} key={shift.id}>
                  <strong>{shift.venueName}</strong>
                  <span>{formatShift(shift.startsAt, shift.endsAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">No upcoming posted shifts.</p>
          )}
        </article>
        <article className="public-panel">
          <h2>Profile</h2>
          <dl className="fact-list">
            <div>
              <dt>City</dt>
              <dd>{profile.city}</dd>
            </div>
            <div>
              <dt>Followers</dt>
              <dd>{profile.followerCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Going</dt>
              <dd>{profile.goingCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Rank</dt>
              <dd>{profile.currentRank ? `#${profile.currentRank}` : "Not ranked yet"}</dd>
            </div>
          </dl>
          <SocialLinks dancerId={profile.id} links={profile.socialLinks} />
        </article>
      </section>
      {gallery.length ? (
        <section className="public-gallery" aria-label={`${profile.stageName} photo gallery`}>
          {gallery.map((photo) => (
            <div className="gallery-photo" key={photo.id} style={{ backgroundImage: `url(${photo.imageUrl})` }} />
          ))}
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

function formatShift(startsAt: string, endsAt: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}

function shortShiftLabel(startsAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
  }).format(new Date(startsAt));
}

function PublicProfileStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .public-profile-shell { min-height: 100vh; padding: 22px clamp(18px, 4vw, 56px) 56px; background: radial-gradient(circle at 78% 8%, rgba(139,92,246,.28), transparent 28rem), linear-gradient(180deg, #090911, #050507 62%); }
      .public-nav { display: flex; justify-content: space-between; align-items: center; max-width: 1120px; margin: 0 auto 28px; color: #b9accd; font-size: 14px; }
      .public-nav a { color: #fff; text-decoration: none; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .public-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 420px); gap: clamp(24px, 5vw, 56px); align-items: stretch; max-width: 1120px; margin: 0 auto; min-height: min(68vh, 620px); }
      .public-copy { display: grid; align-content: center; gap: 18px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(46px, 8vw, 96px); line-height: .92; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .public-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
      .public-actions a { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border-radius: 999px; color: #fff; text-decoration: none; font-weight: 850; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(135deg, rgba(139,92,246,.38), rgba(236,72,153,.18)); }
      .live-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 2px; align-items: center; }
      .live-actions button, .live-actions a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; font-weight: 850; border: 1px solid rgba(148,229,255,.24); background: rgba(148,229,255,.08); cursor: pointer; font: inherit; }
      .live-actions span { color: #94e5ff; font-size: 13px; font-weight: 850; }
      .public-photo { border-radius: 8px; background: linear-gradient(135deg, rgba(139,92,246,.5), rgba(236,72,153,.24)); background-size: cover; background-position: center; min-height: 420px; display: grid; place-items: center; box-shadow: 0 30px 80px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.1); }
      .public-photo span { width: 118px; height: 118px; border-radius: 50%; display: grid; place-items: center; background: rgba(0,0,0,.38); font-size: 32px; font-weight: 900; }
      .public-grid { max-width: 1120px; margin: 34px auto 0; display: grid; grid-template-columns: 1.2fr .8fr; gap: 18px; }
      .public-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.82); border-radius: 8px; padding: 22px; }
      h2 { margin: 0 0 16px; font-size: 20px; }
      .shift-list { display: grid; gap: 10px; }
      .shift-row { display: flex; justify-content: space-between; gap: 14px; color: #f7f2ff; text-decoration: none; padding: 14px; border-radius: 8px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
      .shift-row span, .muted { color: #b9accd; }
      .fact-list { display: grid; gap: 12px; margin: 0; }
      .fact-list div { display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 12px; }
      dt { color: #b9accd; } dd { margin: 0; font-weight: 850; }
      .social-list { display: grid; gap: 10px; margin-top: 18px; }
      .social-list a { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #f7f2ff; text-decoration: none; padding: 12px 14px; border-radius: 8px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
      .social-list span { color: #b9accd; }
      .social-list strong { overflow-wrap: anywhere; text-align: right; }
      .public-gallery { max-width: 1120px; margin: 18px auto 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .gallery-photo { min-height: 220px; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,.1); }
      @media (max-width: 760px) { .public-hero, .public-grid { grid-template-columns: 1fr; } .public-photo { min-height: 340px; } .shift-row, .fact-list div, .social-list a { flex-direction: column; align-items: flex-start; } .social-list strong { text-align: left; } }
    `}</style>
  );
}
