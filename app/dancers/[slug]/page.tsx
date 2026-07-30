import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { FloatingProfileHomeLink } from "@/app/components/FloatingProfileHomeLink";
import { PublicProfileHeader } from "@/app/components/PublicProfileHeader";
import { VenueQrCode, VenueQrUnavailable } from "@/app/components/VenueQrCode";
import { getActiveClubDealForVenue } from "@/src/lib/dancr/deals";
import { getDancerProfile } from "@/src/lib/dancr/public";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import type { ShiftSummary } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  DancerFollowerCount,
  DancerFollowStateProvider,
  DancerGoingCount,
  DancerProfileActions,
} from "./DancerProfileActions";
import { DancerPhotoCarousel } from "./DancerPhotoCarousel";
import {
  ProfileCloseButton,
  ProfileShareButton,
} from "./ProfileNavigationActions";
import { ProfileViewTracker } from "./ProfileViewTracker";
import { SocialLinks } from "./SocialLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DancerPublicPage({ params }: PageProps) {
  const { slug } = await params;
  const client = createAdminSupabaseClient();
  const profile = await getDancerProfile(client, slug);
  if (!profile) notFound();

  const heroPhoto = profile.primaryPhotoUrl || profile.photos[0]?.imageUrl || "";
  const gallery = profile.photos.length ? profile.photos : heroPhoto ? [{ id: "primary", imageUrl: heroPhoto, isPrimary: true, sortOrder: 0 }] : [];
  const activeShift = profile.upcomingShifts.find((shift) => isActiveNow(shift));
  const primaryShift = activeShift || profile.upcomingShifts[0] || null;
  const [activeDeal, tvVideos] = await Promise.all([
    activeShift?.venueId
      ? getActiveClubDealForVenue(client, activeShift.venueId)
      : Promise.resolve(null),
    getPublicMyDancrTvFeed(client, {
      city: profile.city,
      dancerId: profile.id,
      limit: 4,
    }),
  ]);
  const profileStatus = buildProfileStatus(profile.city, primaryShift, Boolean(activeShift));
  const additionalShifts = primaryShift
    ? profile.upcomingShifts.filter((shift) => shift.id !== primaryShift.id)
    : [];

  return (
    <DancerFollowStateProvider
      initialFollowerCount={profile.followerCount}
      initialGoingCount={profile.goingCount}
      key={profile.id}
    >
      <main className="public-profile-shell">
      <FloatingProfileHomeLink city={profile.city} profileType="dancer" />
      <ProfileViewTracker dancerId={profile.id} hasSchedule={profile.upcomingShifts.length > 0} />
      <PublicProfileStyles />
      <PublicProfileHeader
        city={profile.city}
        closeControl={
          <ProfileCloseButton
            fallbackHref={`/?city=${encodeURIComponent(profile.city)}`}
          />
        }
      />
      <section className="public-hero dancer-hero">
        <DancerPhotoCarousel
          photos={gallery.map((photo) => ({
            id: photo.id,
            imageUrl: photo.imageUrl,
          }))}
          videos={tvVideos.map((video) => ({
            id: video.id,
            videoUrl: video.videoUrl,
            caption: video.caption,
            durationSeconds: video.durationSeconds,
          }))}
          stageName={profile.stageName}
        />
        <div className="public-copy">
          <span className={`profile-live-state${activeShift ? " is-working" : ""}`}>
            {profileStatus.eyebrow}
          </span>
          <div className="profile-identity">
            <span className="eyebrow">Verified dancer</span>
            <h1>{profile.stageName}</h1>
            <ProfileShareButton stageName={profile.stageName} />
          </div>
          <section className="profile-status-card" aria-label="Current schedule status">
            <strong>{profileStatus.headline}</strong>
            <span>{profileStatus.detail}</span>
            <div className="profile-status-links">
              <Link href={`/tonight?city=${encodeURIComponent(profile.city)}`}>
                Browse {profile.city}
              </Link>
              {primaryShift?.venueSlug ? (
                <Link
                  href={`/venues/${encodeURIComponent(primaryShift.venueSlug)}`}
                >
                  {primaryShift.venueName}
                </Link>
              ) : null}
            </div>
          </section>
          <DancerProfileActions
            dancerId={profile.id}
            profileName={profile.stageName}
            shifts={profile.upcomingShifts.map((shift) => ({
              id: shift.id,
              label: shortShiftLabel(shift.startsAt, shift.timezone),
              isActive: isActiveNow(shift),
            }))}
          />
        </div>
      </section>
      {activeShift ? (
        <section className="venue-qr-section live-deal-section">
          {activeDeal ? (
            <ClubDealCard
              deal={activeDeal}
              venueId={activeShift.venueId}
              venueName={activeShift.venueName}
              sourceType="dancer_profile"
              dancerId={profile.id}
              dancerNote
              sectionId="club-deal"
              stickyCta
            />
          ) : null}
          {activeShift.venueQrCodeUrl ? (
            <VenueQrCode
              compact
              venueId={activeShift.venueId}
              venueName={activeShift.venueName}
              imageUrl={activeShift.venueQrCodeUrl}
              label={activeShift.venueQrCodeLabel}
              source="dancer_profile"
              dancerId={profile.id}
            />
          ) : (
            <VenueQrUnavailable venueName={activeShift.venueName} />
          )}
        </section>
      ) : null}
      {additionalShifts.length ? (
        <section className="profile-schedule-section" aria-labelledby="profile-schedule-title">
          <div className="profile-section-heading">
            <div>
              <span className="eyebrow">Plan another visit</span>
              <h2 id="profile-schedule-title">More shifts</h2>
            </div>
            <span>{additionalShifts.length} more posted</span>
          </div>
          <div className="shift-list">
            {additionalShifts.map((shift) => {
              const workingNow = isActiveNow(shift);
              return (
                <Link
                  className={`shift-row${workingNow ? " is-working" : ""}`}
                  href={`/venues/${encodeURIComponent(shift.venueSlug)}`}
                  key={shift.id}
                >
                  <span className="shift-date">
                    {workingNow ? "Working now" : formatShiftDate(shift.startsAt, shift.timezone)}
                  </span>
                  <strong>{shift.venueName}</strong>
                  <span className="shift-time">
                    {workingNow
                      ? `Verified check-in · until ${formatShiftTime(shift.endsAt, shift.timezone)}`
                      : `${formatShiftTime(shift.startsAt, shift.timezone)} · ${locationStatusLabel(shift, false)}`}
                  </span>
                  <em>{workingNow ? "Verified live" : "View venue"}</em>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
      <section className="public-grid" aria-label="Profile details">
        <article className="public-panel profile-about-panel">
          <span className="eyebrow">Profile</span>
          <h2>About {profile.stageName}</h2>
          {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
          <dl className="fact-list">
            <div>
              <dt>City</dt>
              <dd>{profile.city}</dd>
            </div>
            <div>
              <dt>Followers</dt>
              <dd>
                <DancerFollowerCount />
              </dd>
            </div>
            <div>
              <dt>Going</dt>
              <dd>
                <DancerGoingCount />
              </dd>
            </div>
            {profile.currentRank ? (
              <div>
                <dt>Rank</dt>
                <dd>#{profile.currentRank}</dd>
              </div>
            ) : null}
          </dl>
        </article>
        {profile.socialLinks.length ? (
          <article className="public-panel profile-connect-panel">
            <span className="eyebrow">Official links</span>
            <h2>Connect with {profile.stageName}</h2>
          <SocialLinks dancerId={profile.id} links={profile.socialLinks} />
          </article>
        ) : null}
      </section>
      </main>
    </DancerFollowStateProvider>
  );
}

function buildProfileStatus(
  city: string,
  shift: ShiftSummary | null,
  workingNow: boolean,
) {
  if (shift && workingNow) {
    return {
      eyebrow: "Working now",
      headline: `Working now at ${shift.venueName}`,
      detail: `Verified check-in · until ${formatShiftTime(shift.endsAt, shift.timezone)}`,
    };
  }
  if (shift) {
    return {
      eyebrow: "Up next",
      headline: `Up next at ${shift.venueName}`,
      detail: `${formatShiftDate(shift.startsAt, shift.timezone)} at ${formatShiftTime(shift.startsAt, shift.timezone)} · posted schedule`,
    };
  }
  return {
    eyebrow: "Verified profile",
    headline: `Based in ${city}`,
    detail: "No posted shift right now. Follow for schedule updates.",
  };
}

function locationStatusLabel(shift: ShiftSummary, workingNow: boolean) {
  if (workingNow) return "Verified check-in";
  if (
    shift.checkedInAt &&
    !shift.checkedOutAt &&
    (shift.locationStatus === "location_confirmed" ||
      shift.locationStatus === "club_confirmed")
  ) {
    return "Check-in confirmed";
  }
  return "Posted shift";
}

function formatShiftDate(startsAt: string, timeZone?: string | null) {
  return formatDateValue(
    startsAt,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
    },
    timeZone,
  );
}

function formatShiftTime(startsAt: string, timeZone?: string | null) {
  return formatDateValue(
    startsAt,
    {
      hour: "numeric",
      minute: "2-digit",
    },
    timeZone,
  );
}

function shortShiftLabel(startsAt: string, timeZone?: string | null) {
  return formatDateValue(
    startsAt,
    {
      weekday: "short",
      month: "numeric",
      day: "numeric",
    },
    timeZone,
  );
}

function formatDateValue(
  value: string,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
) {
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

function isActiveNow(shift: {
  startsAt: string;
  endsAt: string;
  locationStatus?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
}) {
  const now = Date.now();
  const isCheckedIn =
    Boolean(shift.checkedInAt) &&
    !shift.checkedOutAt &&
    (shift.locationStatus === "location_confirmed" || shift.locationStatus === "club_confirmed");
  return isCheckedIn && new Date(shift.startsAt).getTime() <= now && new Date(shift.endsAt).getTime() >= now;
}

function PublicProfileStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, input, select, textarea { font: inherit; }
      .public-profile-shell { min-height: 100vh; padding: 0 clamp(18px, 4vw, 56px) 64px; background: radial-gradient(circle at 78% 8%, rgba(139,92,246,.26), transparent 28rem), linear-gradient(180deg, #090911, #050507 62%); }
      .profile-global-header { position: sticky; z-index: 90; top: 0; max-width: 1180px; margin: 0 auto 22px; padding: max(10px, env(safe-area-inset-top)) 0 10px; border-bottom: 1px solid rgba(126,234,255,.12); background: linear-gradient(180deg, rgba(5,5,8,.98), rgba(5,5,8,.9)); backdrop-filter: blur(22px); }
      .profile-global-topbar { min-height: 50px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; }
      .profile-global-logo { width: fit-content; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 15px; border: 1px solid rgba(139,92,246,.72); border-radius: 15px; color: #fff; background: #050507; box-shadow: 0 0 18px rgba(132,50,255,.24), inset 0 0 16px rgba(132,50,255,.08); font-size: 27px; font-weight: 950; letter-spacing: -.07em; line-height: 1; text-decoration: none; }
      .profile-global-logo span { color: #b976ff; }
      .profile-global-city { min-width: 0; overflow: hidden; color: #b9accd; font-size: 13px; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
      .profile-global-actions { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
      .profile-global-account, .profile-notification-button, .public-profile-close { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(139,92,246,.48); border-radius: 999px; color: #fff; background: rgba(10,10,14,.9); box-shadow: 0 0 18px rgba(124,58,237,.16); text-decoration: none; cursor: pointer; }
      .profile-global-account { padding: 0 15px; font-size: 12px; font-weight: 950; }
      .profile-global-account.profile-account-icon, .profile-notification-button { width: 42px; padding: 0; }
      .profile-global-account svg, .profile-notification-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round; }
      .profile-notification-button { position: relative; color: #22c7ff; cursor: pointer; }
      .profile-notification-count { position: absolute; top: -6px; left: -7px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; border-radius: 999px; color: #050507; background: #22c7ff; font-size: 10px; font-weight: 950; }
      .public-profile-close { width: 42px; padding: 0; font-size: 27px; line-height: 1; }
      .profile-global-account:hover, .profile-global-account:focus-visible, .profile-notification-button:hover, .profile-notification-button:focus-visible, .profile-notification-button.active, .public-profile-close:hover, .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13), 0 0 22px rgba(34,199,255,.18); }
      .profile-notification-panel { position: absolute; z-index: 100; top: calc(100% + 12px); right: 0; width: min(340px, calc(100vw - 28px)); max-height: min(520px, 70dvh); display: grid; gap: 10px; padding: 14px; overflow: auto; border: 1px solid rgba(139,92,246,.42); border-radius: 14px; color: #f7f4ff; background: rgba(5,5,9,.99); box-shadow: 0 22px 60px rgba(0,0,0,.68), 0 0 28px rgba(109,40,217,.2); }
      .profile-notification-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .profile-notification-head > div { display: grid; gap: 2px; }
      .profile-notification-head strong { font-size: 16px; }
      .profile-notification-head span { color: #a99fba; font-size: 11px; font-weight: 800; }
      .profile-notification-head a { color: #7eeaff; font-size: 11px; font-weight: 900; text-decoration: none; }
      .profile-notification-list { display: grid; gap: 7px; }
      .profile-notification-list p { margin: 0; padding: 12px; color: #aaa0b8; text-align: center; }
      .profile-notification-list button { display: grid; gap: 3px; padding: 10px 11px; border: 1px solid rgba(34,199,255,.2); border-radius: 10px; color: #f6f3fb; background: rgba(34,199,255,.07); text-align: left; cursor: pointer; }
      .profile-notification-list button.read { border-color: rgba(255,255,255,.08); background: rgba(255,255,255,.025); }
      .profile-notification-list button span { color: #bdb4ca; font-size: 11px; line-height: 1.35; }
      .profile-notification-clear { min-height: 38px; border: 1px solid rgba(139,92,246,.32); border-radius: 999px; color: #fff; background: rgba(109,40,217,.16); font-weight: 900; cursor: pointer; }
      .profile-notification-status { margin: 0; color: #9fefff; font-size: 11px; font-weight: 800; }
      .public-hero { max-width: 1120px; display: grid; grid-template-areas: "copy photo"; grid-template-columns: minmax(0, 1fr) minmax(300px, 440px); gap: clamp(24px, 5vw, 58px); align-items: center; margin: 0 auto; }
      .public-copy { grid-area: copy; display: grid; align-content: center; gap: 14px; }
      .profile-identity { display: grid; gap: 8px; }
      .profile-share { min-height: 38px; display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
      .profile-share button { min-height: 38px; display: inline-flex; align-items: center; gap: 8px; padding: 0 13px; border: 1px solid rgba(126,234,255,.34); border-radius: 999px; color: #fff; background: rgba(34,199,255,.1); font-size: 12px; font-weight: 900; cursor: pointer; }
      .profile-share button:hover, .profile-share button:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.12); }
      .profile-share svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      .profile-share > span { color: #9fefff; font-size: 11px; font-weight: 800; }
      .eyebrow, .profile-live-state { color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .17em; text-transform: uppercase; }
      .profile-live-state { width: fit-content; padding: 7px 11px; border: 1px solid rgba(148,229,255,.28); border-radius: 999px; background: rgba(148,229,255,.08); }
      .profile-live-state.is-working { border-color: rgba(126,234,255,.58); color: #dffbff; background: linear-gradient(135deg, rgba(109,40,217,.62), rgba(11,148,201,.42)); box-shadow: 0 0 22px rgba(34,199,255,.14); }
      h1 { margin: 0; font-size: clamp(46px, 7vw, 82px); line-height: .94; letter-spacing: -.045em; overflow-wrap: anywhere; }
      h2 { margin: 0; font-size: 22px; line-height: 1.1; }
      p { margin: 0; color: #cfc5de; font-size: 16px; line-height: 1.55; max-width: 58ch; }
      .profile-status-card { display: grid; gap: 7px; padding: 16px; border: 1px solid rgba(139,92,246,.28); border-radius: 15px; background: linear-gradient(135deg, rgba(109,40,217,.17), rgba(34,199,255,.055)); }
      .profile-status-card > strong { font-size: clamp(18px, 2.2vw, 24px); line-height: 1.15; }
      .profile-status-card > span { color: #b9accd; font-size: 13px; font-weight: 750; }
      .profile-status-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; }
      .profile-status-links a { min-height: 38px; display: inline-flex; align-items: center; padding: 0 13px; border: 1px solid rgba(255,255,255,.11); border-radius: 999px; color: #fff; background: rgba(255,255,255,.045); font-size: 12px; font-weight: 900; text-decoration: none; }
      .live-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; align-items: stretch; }
      .live-actions button { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 6px 13px; border: 1px solid rgba(148,229,255,.24); border-radius: 13px; color: #fff; background: rgba(148,229,255,.075); cursor: pointer; font: inherit; font-size: 13px; font-weight: 900; }
      .live-actions button:disabled { opacity: .66; cursor: wait; }
      .live-actions .profile-action-primary { grid-column: 1 / -1; min-height: 58px; flex-direction: column; gap: 2px; border-color: rgba(126,234,255,.58); background: linear-gradient(135deg, #6d28d9, #0b94c9); box-shadow: 0 14px 32px rgba(35,114,178,.24); font-size: 16px; }
      .live-actions .profile-action-secondary.profile-action-requires-account { flex-direction: column; gap: 1px; }
      .live-actions .profile-action-requirement { color: #c7bbd8; font-size: 9px; font-weight: 850; line-height: 1.1; }
      .live-actions .profile-action-public .profile-action-requirement { color: #d8f7ff; }
      .live-actions .profile-action-report { grid-column: 1 / -1; min-height: 32px; justify-self: end; padding: 0 4px; border: 0; color: #958aa4; background: transparent; font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
      .live-actions .profile-action-status { grid-column: 1 / -1; color: #94e5ff; font-size: 12px; font-weight: 850; }
      .profile-account-gate { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.78); backdrop-filter: blur(11px); }
      .profile-report-gate { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.78); backdrop-filter: blur(11px); }
      .profile-account-gate-dialog, .profile-report-dialog { position: relative; width: min(430px, 100%); display: grid; gap: 14px; padding: 24px; border: 1px solid rgba(53,216,255,.42); border-radius: 16px; background: radial-gradient(circle at 88% 8%, rgba(53,216,255,.12), transparent 12rem), linear-gradient(145deg, #0b0b13, #060609); box-shadow: 0 28px 90px rgba(0,0,0,.72), 0 0 34px rgba(53,216,255,.1); }
      .profile-account-gate-dialog > span, .profile-report-dialog > span { color: #7eeaff; font-size: 11px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .profile-account-gate-dialog h2, .profile-report-dialog h2 { padding-right: 40px; font-size: clamp(24px, 6vw, 32px); }
      .profile-account-gate-dialog p, .profile-report-dialog p { color: #cfc5de; font-size: 14px; font-weight: 700; line-height: 1.5; }
      .profile-account-gate-dialog > div { display: grid; gap: 10px; }
      .profile-account-gate-dialog a { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border: 1px solid rgba(53,216,255,.48); border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-size: 15px; font-weight: 950; text-align: center; text-decoration: none; }
      .profile-account-gate-dialog a.secondary { min-height: 42px; border-color: rgba(255,255,255,.14); color: #d9d0e8; background: rgba(255,255,255,.04); }
      .profile-account-gate-close, .profile-report-close { position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(53,216,255,.42); border-radius: 50%; color: #fff; background: rgba(4,9,15,.9); font-size: 26px; line-height: 1; cursor: pointer; }
      .profile-report-dialog form { display: grid; gap: 13px; }
      .profile-report-dialog label { display: grid; gap: 7px; color: #e9e2f4; font-size: 13px; font-weight: 900; }
      .profile-report-dialog label small { color: #9387a3; font-weight: 750; }
      .profile-report-dialog select, .profile-report-dialog textarea { width: 100%; border: 1px solid rgba(139,92,246,.35); border-radius: 11px; color: #fff; background: rgba(255,255,255,.055); outline: none; }
      .profile-report-dialog select { min-height: 48px; padding: 0 12px; }
      .profile-report-dialog option { color: #111; }
      .profile-report-dialog textarea { min-height: 110px; padding: 12px; resize: vertical; }
      .profile-report-dialog select:focus, .profile-report-dialog textarea:focus { border-color: #7eeaff; box-shadow: 0 0 0 3px rgba(126,234,255,.13); }
      .profile-report-dialog form > button { min-height: 48px; border: 0; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; cursor: pointer; }
      .profile-report-error { color: #ffb4c8 !important; font-size: 13px !important; font-weight: 850 !important; }
      .public-photo { grid-area: photo; position: relative; min-height: 520px; display: grid; place-items: center; overflow: hidden; border: 1px solid rgba(255,255,255,.1); border-radius: 20px; background: linear-gradient(135deg, rgba(139,92,246,.5), rgba(236,72,153,.24)); box-shadow: 0 30px 80px rgba(0,0,0,.45); touch-action: pan-y; overscroll-behavior-x: contain; user-select: none; cursor: grab; }
      .public-photo:active { cursor: grabbing; }
      .public-photo:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .public-profile-video { position: absolute; inset: 0; display: grid; place-items: center; background: #000; }
      .public-profile-video video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; }
      .public-media-badge { position: absolute; z-index: 2; top: 14px; left: 14px; width: auto !important; height: auto !important; display: inline-flex !important; align-items: center; padding: 6px 9px !important; border: 1px solid rgba(126,234,255,.42) !important; border-radius: 999px !important; color: #e9fcff; background: rgba(5,5,8,.78) !important; font-size: 10px !important; font-weight: 950 !important; letter-spacing: .08em; text-transform: uppercase; pointer-events: none; backdrop-filter: blur(8px); }
      .public-video-caption { position: absolute; z-index: 2; top: 51px; left: 14px; max-width: min(70%, 300px); display: -webkit-box; padding: 7px 9px; overflow: hidden; border-radius: 9px; color: #fff; background: rgba(5,5,8,.72); font-size: 11px; font-weight: 750; line-height: 1.3; text-shadow: 0 1px 4px rgba(0,0,0,.8); pointer-events: none; -webkit-box-orient: vertical; -webkit-line-clamp: 2; backdrop-filter: blur(8px); }
      .public-photo-image { position: absolute; inset: 0; background-position: center top; background-repeat: no-repeat; background-size: cover; }
      .public-photo > span:not(.public-photo-status) { width: 118px; height: 118px; display: grid; place-items: center; border-radius: 50%; background: rgba(0,0,0,.38); font-size: 32px; font-weight: 900; }
      .public-photo-nav { position: absolute; z-index: 2; top: 50%; width: 44px; height: 54px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; color: #fff; background: rgba(5,5,8,.62); box-shadow: 0 10px 28px rgba(0,0,0,.32); font-size: 34px; line-height: 1; cursor: pointer; transform: translateY(-50%); backdrop-filter: blur(8px); }
      .public-photo-nav.previous { left: 12px; }
      .public-photo-nav.next { right: 12px; }
      .public-photo-nav:hover, .public-photo-nav:focus-visible { border-color: #7eeaff; outline: none; background: rgba(45,16,111,.88); }
      .public-photo-dots { position: absolute; z-index: 2; left: 50%; bottom: 14px; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 7px 9px; border-radius: 999px; background: rgba(5,5,8,.66); transform: translateX(-50%); backdrop-filter: blur(8px); }
      .public-photo-dots button { width: 9px; height: 9px; padding: 0; border: 1px solid rgba(255,255,255,.48); border-radius: 50%; background: rgba(255,255,255,.2); cursor: pointer; }
      .public-gallery[data-active-media-type="video"] .public-photo-dots { top: 14px; right: 14px; bottom: auto; left: auto; max-width: calc(100% - 110px); overflow-x: auto; transform: none; }
      .public-photo-dots button.is-video { width: 18px; border-radius: 999px; }
      .public-photo-dots button.is-video::after { content: "▶"; display: block; color: #fff; font-size: 6px; line-height: 7px; }
      .public-photo-dots button[aria-pressed="true"] { border-color: #7eeaff; background: #7eeaff; box-shadow: 0 0 12px rgba(126,234,255,.6); }
      .public-photo-status { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
      .venue-qr-section, .profile-schedule-section, .public-grid { max-width: 1120px; margin: 24px auto 0; }
      .live-deal-section { display: grid; gap: 14px; }
      .venue-published-qr { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 20px; align-items: center; padding: 20px; border: 1px solid rgba(34,199,255,.28); border-radius: 16px; background: rgba(12,12,18,.88); }
      .venue-published-qr h2 { margin: 7px 0; }
      .venue-published-qr img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 10px; background: #fff; }
      .venue-qr-unavailable { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(12,12,18,.72); }
      .venue-qr-unavailable p { color: #b9accd; font-size: 14px; line-height: 1.4; }
      .profile-schedule-section { display: grid; gap: 14px; padding: 20px; border: 1px solid rgba(139,92,246,.27); border-radius: 18px; background: rgba(10,10,16,.84); box-shadow: 0 20px 60px rgba(0,0,0,.28); }
      .profile-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
      .profile-section-heading > div { display: grid; gap: 6px; }
      .profile-section-heading > span { color: #9487a5; font-size: 12px; font-weight: 850; }
      .shift-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
      .shift-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 14px; border: 1px solid rgba(255,255,255,.085); border-radius: 14px; color: #f7f2ff; background: rgba(255,255,255,.035); text-decoration: none; }
      .shift-row.is-working { border-color: rgba(126,234,255,.45); background: linear-gradient(135deg, rgba(109,40,217,.2), rgba(34,199,255,.07)); }
      .shift-row .shift-date { grid-column: 1 / -1; color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .shift-row strong { min-width: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .shift-row .shift-time { grid-column: 1; color: #b9accd; font-size: 12px; line-height: 1.35; }
      .shift-row em { grid-column: 2; grid-row: 2 / span 2; align-self: center; width: fit-content; padding: 6px 9px; border: 1px solid rgba(148,229,255,.22); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.08); font-size: 9px; font-style: normal; font-weight: 950; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; }
      .muted { color: #b9accd; }
      .public-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; }
      .public-panel { display: grid; align-content: start; gap: 14px; padding: 22px; border: 1px solid rgba(139,92,246,.24); border-radius: 16px; background: rgba(12,12,18,.82); }
      .profile-bio { color: #d5cbdf; font-size: 16px; line-height: 1.55; }
      .fact-list { display: grid; gap: 12px; margin: 0; }
      .fact-list div { display: flex; justify-content: space-between; gap: 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      dt { color: #b9accd; } dd { margin: 0; font-weight: 850; }
      .social-links-control { display: grid; gap: 10px; }
      .social-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .social-list a { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; color: #f7f2ff; background: rgba(255,255,255,.04); text-decoration: none; }
      .social-list span { color: #b9accd; }
      .social-list strong { overflow-wrap: anywhere; text-align: right; }
      .social-list-toggle { min-height: 40px; justify-self: start; padding: 0 14px; border: 1px solid rgba(126,234,255,.26); border-radius: 999px; color: #9fefff; background: rgba(34,199,255,.08); font-size: 12px; font-weight: 900; cursor: pointer; }
      .club-deal-card { border-radius: 16px; }
      @media (max-width: 760px) {
        .public-gallery { overflow-x: auto; scroll-snap-type: x mandatory; touch-action: pan-x pan-y; }
        .public-profile-shell { padding: 0 12px 98px; }
        .profile-global-header { margin: 0 -2px 12px; padding-inline: 2px; }
        .profile-global-topbar { grid-template-columns: 46px minmax(0, 1fr) auto; gap: 7px; }
        .profile-global-logo { visibility: hidden; width: 46px; min-height: 40px; padding: 0; font-size: 0; pointer-events: none; }
        .profile-global-city { display: none; }
        .profile-global-actions { grid-column: 2 / 4; gap: 6px; }
        .profile-global-account { min-height: 40px; padding-inline: 11px; }
        .profile-global-account.profile-account-icon, .profile-notification-button, .public-profile-close { width: 40px; min-height: 40px; }
        .profile-notification-panel { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 68px); left: 10px; right: 10px; width: auto; max-height: calc(100dvh - env(safe-area-inset-top, 0px) - 88px); }
        .public-hero { grid-template-areas: "photo" "copy"; grid-template-columns: 1fr; gap: 15px; align-items: start; }
        .public-photo { min-height: 0; aspect-ratio: 4 / 5; border-radius: 18px; }
        .public-copy { gap: 12px; }
        h1 { font-size: clamp(38px, 12vw, 52px); }
        .profile-status-card { padding: 14px; }
        .profile-status-card > strong { font-size: 18px; }
        .profile-status-links a { min-height: 36px; padding-inline: 11px; font-size: 11px; }
        .public-photo-nav { width: 40px; height: 48px; font-size: 30px; }
        .venue-published-qr, .public-grid { grid-template-columns: 1fr; }
        .venue-published-qr img { max-width: 230px; justify-self: center; }
        .profile-schedule-section { padding: 16px; }
        .shift-list { grid-template-columns: 1fr; }
        .shift-row strong { white-space: normal; }
        .social-list { grid-template-columns: 1fr; }
        .fact-list div, .social-list a { align-items: flex-start; }
        .social-list a { flex-direction: column; }
        .social-list strong { text-align: left; }
        .profile-account-gate-dialog, .profile-report-dialog { max-height: calc(100dvh - 24px); overflow-y: auto; padding: 21px; }
      }
    `}</style>
  );
}
