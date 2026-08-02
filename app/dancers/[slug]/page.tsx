import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { VenueQrUnavailable } from "@/app/components/VenueQrCode";
import { createDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
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

  const heroPhoto =
    profile.primaryPhotoUrl || profile.photos[0]?.imageUrl || "";
  const heroPhotoSrcSet =
    profile.primaryPhotoSrcSet || profile.photos[0]?.imageSrcSet || null;
  const heroPhotoWidth =
    profile.primaryPhotoWidth || profile.photos[0]?.imageWidth || null;
  const heroPhotoHeight =
    profile.primaryPhotoHeight || profile.photos[0]?.imageHeight || null;
  const gallery = profile.photos.length
    ? profile.photos
    : heroPhoto
      ? [{ id: "primary", imageUrl: heroPhoto, isPrimary: true, sortOrder: 0 }]
      : [];
  const activeShift = profile.upcomingShifts.find((shift) => isActiveNow(shift));
  const upcomingShifts = profile.upcomingShifts.filter(
    (shift) => shift.id !== activeShift?.id,
  );
  const [activeDeal, tvVideos] = await Promise.all([
    activeShift?.venueId
      ? getActiveClubDealForVenue(client, activeShift.venueId)
      : Promise.resolve(null),
    getPublicMyDancrTvFeed(client, {
      city: profile.city,
      dancerId: profile.id,
      limit: 12,
    }),
  ]);
  const dealAttributionToken = activeShift && activeDeal
    ? createDancerDealAttributionToken({
        dancerId: profile.id,
        venueId: activeShift.venueId,
        dealId: activeDeal.id,
        shiftId: activeShift.id,
      })
    : null;

  return (
    <DancerFollowStateProvider
      initialFollowerCount={profile.followerCount}
      initialGoingCount={profile.goingCount}
      initialNotificationCount={profile.notificationCount || 0}
      key={profile.id}
    >
      <main className="public-profile-shell">
        <ProfileViewTracker
          dancerId={profile.id}
          hasSchedule={profile.upcomingShifts.length > 0}
        />
        <PublicProfileStyles />

        <header className="profile-titlebar">
          <div
            aria-label={`${profile.stageName} profile photo`}
            className={`profile-titlebar-avatar${heroPhoto ? " has-photo" : ""}`}
            role="img"
          >
            {heroPhoto ? (
              <img
                alt=""
                aria-hidden="true"
                decoding="async"
                height={heroPhotoHeight || undefined}
                sizes="46px"
                src={heroPhoto}
                srcSet={heroPhotoSrcSet || undefined}
                width={heroPhotoWidth || undefined}
              />
            ) : initials(profile.stageName)}
          </div>
          <div className="profile-titlebar-identity">
            <div>
              <h1>{profile.stageName}</h1>
              <span className="profile-verified" aria-label="Verified dancer">
                ✓
              </span>
            </div>
            <div className="profile-titlebar-context">
              <span className="profile-titlebar-city">{profile.city}</span>
            </div>
          </div>
          <ProfileCloseButton
            fallbackHref={`/?city=${encodeURIComponent(profile.city)}&view=dancers`}
          />
        </header>

        <DancerPhotoCarousel
          photos={gallery.map((photo) => ({
            id: photo.id,
            imageUrl: photo.imageUrl,
            imageSrcSet: photo.imageSrcSet,
            imageWidth: photo.imageWidth,
            imageHeight: photo.imageHeight,
          }))}
          videos={tvVideos.map((video) => ({
            id: video.id,
            videoUrl: video.videoUrl,
            durationSeconds: video.durationSeconds,
          }))}
          stageName={profile.stageName}
        />

        {upcomingShifts.length ? (
          <section
            className="profile-schedule-section"
            aria-labelledby="profile-schedule-title"
          >
            <div className="profile-section-heading">
              <div>
                <span className="eyebrow">Schedule</span>
                <h2 id="profile-schedule-title">Upcoming shifts</h2>
              </div>
              <span>{upcomingShifts.length} posted</span>
            </div>
            <div className="shift-list">
              {upcomingShifts.map((shift) => (
                <Link
                  className="shift-row"
                  href={`/venues/${encodeURIComponent(shift.venueSlug)}`}
                  key={shift.id}
                >
                  <span className="shift-date">
                    {formatShiftDate(shift.startsAt, shift.timezone)}
                  </span>
                  <strong>{shift.venueName}</strong>
                  <span className="shift-time">
                    {formatShiftTime(shift.startsAt, shift.timezone)} · Posted shift
                  </span>
                  <em>Venue</em>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {activeShift ? (
          <section
            className={`profile-working-card${activeDeal ? " has-club-deal" : ""}`}
            aria-labelledby="profile-working-title"
          >
            <div className="profile-working-head">
              <div>
                <span className="profile-live-state">
                  {activeDeal ? "Club Deal unlocked" : "Working now"}
                </span>
                <h2 id="profile-working-title">
                  {activeDeal ? `Club Deal at ${activeShift.venueName}` : activeShift.venueName}
                </h2>
                <p>
                  {activeDeal
                    ? `Open a dancer-attributed QR during this verified check-in, available until ${formatShiftTime(activeShift.endsAt, activeShift.timezone)}.`
                    : `Verified check-in · until ${formatShiftTime(activeShift.endsAt, activeShift.timezone)}`}
                </p>
              </div>
              <Link href={`/venues/${encodeURIComponent(activeShift.venueSlug)}`}>
                Venue &amp; directions
              </Link>
            </div>
            <div className="profile-working-qr">
              {activeDeal ? (
                <ClubDealCard
                  deal={activeDeal}
                  venueId={activeShift.venueId}
                  venueName={activeShift.venueName}
                  sourceType="dancer_profile"
                  dancerId={profile.id}
                  attributionToken={dealAttributionToken}
                  dancerNote
                  presentation="launcher"
                  ctaLabel="Get Club Deal QR"
                  sectionId="club-deal"
                />
              ) : (
                <VenueQrUnavailable venueName={activeShift.venueName} />
              )}
            </div>
          </section>
        ) : (
          <section className="profile-deal-availability" aria-label="Club Deal status">
            <VenueQrUnavailable
              availability={upcomingShifts.length ? "available-when-working" : "not-available-now"}
              venueName={upcomingShifts[0]?.venueName || profile.city}
            />
          </section>
        )}

        <DancerProfileActions
          dancerId={profile.id}
          hasPrimaryDeal={Boolean(activeShift && activeDeal)}
          profileName={profile.stageName}
          shareControl={<ProfileShareButton stageName={profile.stageName} />}
          shifts={profile.upcomingShifts.map((shift) => ({
            id: shift.id,
            label: shortShiftLabel(shift.startsAt, shift.timezone),
            isActive: isActiveNow(shift),
          }))}
        />

        {profile.socialLinks.length ? (
          <section className="profile-social-section" aria-labelledby="profile-social-heading">
            <SocialLinks dancerId={profile.id} links={profile.socialLinks} />
          </section>
        ) : null}

        <section className="profile-overview" aria-label={`${profile.stageName} profile summary`}>
          <dl className="profile-metrics" aria-label="Profile activity">
            <div>
              <dd><DancerFollowerCount /></dd>
              <dt>Followers</dt>
            </div>
            <div>
              <dd><DancerGoingCount /></dd>
              <dt>Going</dt>
            </div>
            <div>
              <dd>{profile.profileViewsToday || 0}</dd>
              <dt>Views today</dt>
            </div>
          </dl>
        </section>

      </main>
    </DancerFollowStateProvider>
  );
}

function formatShiftDate(startsAt: string, timeZone?: string | null) {
  return formatDateValue(
    startsAt,
    { weekday: "short", month: "short", day: "numeric" },
    timeZone,
  );
}

function formatShiftTime(startsAt: string, timeZone?: string | null) {
  return formatDateValue(
    startsAt,
    { hour: "numeric", minute: "2-digit" },
    timeZone,
  );
}

function shortShiftLabel(startsAt: string, timeZone?: string | null) {
  return formatDateValue(
    startsAt,
    { weekday: "short", month: "numeric", day: "numeric" },
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

function isActiveNow(shift: ShiftSummary) {
  const now = Date.now();
  const isCheckedIn =
    Boolean(shift.checkedInAt) &&
    !shift.checkedOutAt &&
    (shift.locationStatus === "location_confirmed" ||
      shift.locationStatus === "club_confirmed");
  return (
    isCheckedIn &&
    new Date(shift.startsAt).getTime() <= now &&
    new Date(shift.endsAt).getTime() >= now
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

function PublicProfileStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, input, select, textarea { font: inherit; }
      .public-profile-shell { min-height: 100vh; padding: 0 clamp(18px, 4vw, 56px) 64px; background: radial-gradient(circle at 78% 8%, rgba(139,92,246,.22), transparent 28rem), linear-gradient(180deg, #090911, #050507 62%); }
      .profile-titlebar { position: relative; z-index: 1; max-width: 760px; min-height: 64px; display: flex; align-items: center; justify-content: flex-start; gap: 10px; margin: 0 auto; padding: max(8px, env(safe-area-inset-top)) 0 8px; border-bottom: 0; background: radial-gradient(circle at 14% 0%, rgba(126,234,255,.055), transparent 11rem), linear-gradient(180deg, rgba(5,5,8,.98), rgba(5,5,8,.92)); box-shadow: 0 8px 24px rgba(0,0,0,.2); backdrop-filter: blur(22px); }
      .profile-titlebar-avatar { width: 42px; height: 42px; display: grid; flex: 0 0 42px; place-items: center; overflow: hidden; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgba(124,58,237,.72), rgba(34,199,255,.35)); box-shadow: 0 10px 26px rgba(0,0,0,.36), 0 0 18px rgba(124,58,237,.15); font-size: 13px; font-weight: 950; }
      .profile-titlebar-avatar.has-photo { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-titlebar-avatar img { width: 100%; height: 100%; display: block; object-fit: cover; }
      .profile-titlebar-identity { min-width: 0; display: grid; flex: 1 1 auto; gap: 6px; }
      .profile-titlebar-identity > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
      .profile-titlebar h1 { margin: 0; overflow: hidden; font-size: clamp(20px, 4vw, 26px); line-height: 1.05; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
      .profile-titlebar-identity > .profile-titlebar-context { gap: 6px; overflow: hidden; }
      .profile-titlebar-status { min-height: 20px; display: inline-flex; flex: 0 0 auto; align-items: center; padding: 0 7px; border: 1px solid rgba(126,234,255,.3); border-radius: 999px; color: #b9f6ff; background: rgba(126,234,255,.08); font-size: 8px; font-weight: 950; letter-spacing: .04em; line-height: 1; text-transform: uppercase; white-space: nowrap; }
      .profile-titlebar-status.is-live { border-color: rgba(77,236,157,.54); color: #b7ffd8; background: rgba(23,137,82,.18); box-shadow: 0 0 14px rgba(77,236,157,.12); }
      .profile-titlebar-status.is-empty { border-color: rgba(180,169,196,.2); color: #a99eb7; background: rgba(255,255,255,.035); }
      .profile-titlebar-context a, .profile-titlebar-city { min-width: 0; overflow: hidden; color: #c8bfd6; font-size: 10px; font-weight: 850; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
      .profile-titlebar-city { min-height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border: 1px solid rgba(180,169,196,.14); border-radius: 999px; background: rgba(255,255,255,.035); }
      .profile-titlebar-context a:hover, .profile-titlebar-context a:focus-visible { color: #9fefff; outline: none; text-decoration: underline; text-underline-offset: 3px; }
      .profile-verified { width: 20px; height: 20px; flex: 0 0 20px; display: inline-grid; place-items: center; border-radius: 50%; color: #051019; background: #7eeaff; box-shadow: 0 0 15px rgba(126,234,255,.3); font-size: 12px; font-weight: 950; }
      .public-profile-close { width: 40px; min-height: 40px; display: inline-grid; flex: 0 0 40px; place-items: center; padding: 0; border: 1px solid rgba(180,169,196,.2); border-radius: 50%; color: #fff; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 10px 24px rgba(0,0,0,.28); font-size: 26px; line-height: 1; cursor: pointer; }
      .public-profile-close:hover, .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13), 0 0 22px rgba(34,199,255,.18); }
      .profile-overview, .profile-social-section, .live-actions, .profile-working-card, .profile-deal-availability, .profile-media-section, .profile-schedule-section { width: min(100%, 760px); margin-inline: auto; }
      .profile-overview { display: block; margin-top: 0; padding: 10px 0 4px; border-top: 1px solid rgba(126,234,255,.08); }
      .profile-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; }
      .profile-metrics > div { min-width: 0; display: grid; gap: 4px; justify-items: center; padding: 8px 4px; }
      .profile-metrics dd { margin: 0; color: #eee9f5; font-size: clamp(18px, 3.5vw, 24px); font-weight: 950; line-height: 1; }
      .profile-metrics dt { color: #8f849c; font-size: clamp(9px, 2.1vw, 11px); font-weight: 850; text-align: center; }
      .profile-social-section { display: grid; margin-top: 20px; margin-bottom: 8px; padding: 15px 14px 14px; border: 1px solid rgba(126,234,255,.18); border-radius: 18px; background: radial-gradient(circle at 50% 0%, rgba(126,234,255,.08), transparent 11rem), rgba(13,10,23,.72); box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 16px 38px rgba(0,0,0,.2); }
      .social-links-control { display: grid; justify-items: center; gap: 12px; text-align: center; }
      .social-list-heading { display: grid; justify-items: center; gap: 3px; }
      .social-list-heading > span { color: #94e5ff; font-size: 9px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .social-list-heading h2 { margin: 0; font-size: 15px; line-height: 1.1; }
      .social-list { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
      .social-list a { width: 48px; min-width: 48px; height: 48px; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 48px; padding: 0; border: 1px solid rgba(139,92,246,.34); border-radius: 50%; color: #fff; background: linear-gradient(135deg, rgba(139,92,246,.14), rgba(34,199,255,.06)); box-shadow: inset 0 1px 0 rgba(255,255,255,.045); text-decoration: none; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease; }
      .social-list a:hover { border-color: rgba(126,234,255,.56); background: linear-gradient(135deg, rgba(139,92,246,.22), rgba(34,199,255,.12)); box-shadow: 0 0 18px rgba(34,199,255,.1); transform: translateY(-1px); }
      .social-list a:focus-visible { border-color: #7eeaff; outline: 2px solid rgba(126,234,255,.72); outline-offset: 3px; }
      .social-list a svg { width: 23px; height: 23px; display: block; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .social-list a.social-link-instagram svg, .social-list a.social-link-x svg { fill: none; }
      .social-list a .logo-cutout { fill: #0d0a17; stroke: none; }
      @media (prefers-reduced-motion: reduce) { .social-list a { transition: none; } }
      .live-actions { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 14px 0 12px; }
      .live-actions > button, .profile-action-share-slot .profile-share button { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 7px 10px; border: 1px solid rgba(148,229,255,.24); border-radius: 12px; color: #fff; background: rgba(148,229,255,.075); cursor: pointer; font-size: 12px; font-weight: 900; text-align: center; }
      .live-actions > button:disabled { opacity: .66; cursor: wait; }
      .live-actions .profile-action-going { grid-column: 1 / -1; min-height: 54px; flex-direction: column; gap: 2px; }
      .live-actions .profile-action-primary { border-color: rgba(126,234,255,.48); background: linear-gradient(135deg, rgba(109,40,217,.86), rgba(11,148,201,.74)); box-shadow: 0 12px 30px rgba(49,46,129,.2), 0 0 18px rgba(34,199,255,.08); }
      .live-actions .profile-action-primary.profile-action-unavailable { border-color: rgba(148,137,166,.3); color: #bdb4ca; background: rgba(255,255,255,.055); }
      .live-actions .profile-action-going.profile-action-secondary { border-color: rgba(148,229,255,.26); background: linear-gradient(135deg, rgba(38,31,56,.82), rgba(18,33,44,.76)); box-shadow: none; }
      .profile-action-requires-account { flex-direction: column; gap: 1px; }
      .profile-action-requirement { color: #c7bbd8; font-size: 8px; font-weight: 850; line-height: 1.1; }
      .profile-action-share-slot { min-width: 0; }
      .profile-action-share-slot .profile-share { display: block; min-height: 48px; }
      .profile-action-share-slot .profile-share button { gap: 6px; }
      .profile-action-share-slot .profile-share svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; }
      .profile-action-share-slot .profile-share > span { display: block; color: #9fefff; font-size: 9px; text-align: center; }
      .profile-share-dialog-backdrop { position: fixed; z-index: 1750; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.84); backdrop-filter: blur(12px); }
      .profile-share-dialog { position: relative; width: min(430px, 100%); max-height: calc(100dvh - 28px); display: grid; gap: 14px; overflow-y: auto; padding: 24px; border: 1px solid rgba(126,234,255,.42); border-radius: 18px; color: #f7f2ff; background: radial-gradient(circle at 82% 4%, rgba(34,199,255,.14), transparent 15rem), linear-gradient(145deg, #0d0a18, #050507); box-shadow: 0 28px 90px rgba(0,0,0,.74), 0 0 38px rgba(109,40,217,.22); }
      .profile-share-dialog > span:first-of-type { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .15em; text-transform: uppercase; }
      .profile-share-dialog h2 { padding-right: 42px; }
      .profile-share-dialog p { color: #cfc5de; font-size: 13px; }
      .profile-share-dialog-close { position: absolute; z-index: 2; top: 11px; right: 11px; width: 40px !important; min-height: 40px !important; display: grid !important; place-items: center; padding: 0 !important; border: 1px solid rgba(126,234,255,.38) !important; border-radius: 50% !important; color: #fff; background: rgba(5,5,7,.86) !important; font-size: 27px !important; cursor: pointer; }
      .profile-share-qr { display: grid; justify-items: center; gap: 9px; padding: 14px; border: 1px solid rgba(126,234,255,.18); border-radius: 14px; background: rgba(0,0,0,.28); }
      .profile-share-qr strong { color: #fff; font-size: 14px; }
      .profile-share-qr img { width: min(240px, 70vw); aspect-ratio: 1; padding: 8px; border-radius: 12px; background: #fff; box-shadow: 0 0 30px rgba(34,199,255,.18); }
      .profile-share-qr > div { min-height: 150px; display: grid; place-items: center; color: #9fefff; }
      .profile-share-qr small { color: #a99eb7; font-size: 11px; }
      .profile-share-dialog-actions { display: grid; gap: 9px; }
      .profile-action-share-slot .profile-share-dialog-actions button { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border: 1px solid rgba(126,234,255,.28); border-radius: 999px; color: #fff; background: rgba(126,234,255,.07); font-size: 12px; font-weight: 950; cursor: pointer; }
      .profile-action-share-slot .profile-share-dialog-actions button.primary { border-color: transparent; background: linear-gradient(135deg, #6d28d9, #0b94c9); }
      .profile-share-dialog-actions svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.9; }
      .profile-share-dialog-status { min-height: 16px; color: #9fefff; font-size: 11px; font-weight: 850; text-align: center; }
      .profile-action-overflow { position: relative; min-width: 0; }
      .profile-action-overflow-toggle { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 7px 10px; border: 1px solid rgba(148,229,255,.18); border-radius: 12px; color: #d8d0e4; background: rgba(255,255,255,.04); cursor: pointer; font-size: 12px; font-weight: 900; }
      .profile-action-overflow-toggle > span:first-child { color: #9fefff; font-size: 15px; letter-spacing: .08em; line-height: 1; }
      .profile-action-overflow-menu { position: absolute; z-index: 30; right: 0; top: calc(100% + 7px); width: min(220px, 74vw); display: grid; gap: 6px; padding: 8px; border: 1px solid rgba(126,234,255,.28); border-radius: 13px; background: rgba(10,8,16,.98); box-shadow: 0 18px 48px rgba(0,0,0,.56), 0 0 20px rgba(34,199,255,.08); }
      .profile-action-overflow-menu button { min-height: 44px; padding: 0 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; color: #d8d0e4; background: rgba(255,255,255,.035); font-size: 12px; font-weight: 850; text-align: left; cursor: pointer; }
      .profile-action-overflow-menu button:disabled { opacity: .6; cursor: wait; }
      .profile-action-status { grid-column: 1 / -1; color: #94e5ff; font-size: 12px; font-weight: 850; }
      .profile-working-card { display: grid; gap: 14px; margin-top: 14px; padding: 18px; border: 1px solid rgba(126,234,255,.38); border-radius: 18px; background: radial-gradient(circle at 88% 8%, rgba(34,199,255,.14), transparent 16rem), linear-gradient(145deg, rgba(29,11,67,.94), rgba(7,11,18,.96)); box-shadow: 0 22px 70px rgba(0,0,0,.38), 0 0 28px rgba(34,199,255,.1); }
      .profile-working-card.has-club-deal { border-color: rgba(77,236,157,.48); background: radial-gradient(circle at 88% 8%, rgba(77,236,157,.16), transparent 16rem), linear-gradient(145deg, rgba(7,52,39,.94), rgba(5,10,13,.97)); box-shadow: 0 22px 70px rgba(0,0,0,.38), 0 0 30px rgba(77,236,157,.13); }
      .profile-working-head { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
      .profile-working-head > div { min-width: 0; display: grid; gap: 7px; }
      .profile-live-state, .eyebrow { width: fit-content; color: #94e5ff; font-size: 10px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .profile-live-state { padding: 6px 10px; border: 1px solid rgba(126,234,255,.48); border-radius: 999px; background: rgba(126,234,255,.1); }
      h2 { margin: 0; font-size: clamp(22px, 5vw, 32px); line-height: 1.05; }
      p { margin: 0; color: #cfc5de; font-size: 13px; line-height: 1.45; }
      .profile-working-head > a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 13px; border: 1px solid rgba(126,234,255,.34); border-radius: 999px; color: #fff; background: rgba(34,199,255,.09); font-size: 11px; font-weight: 900; text-decoration: none; white-space: nowrap; }
      .profile-working-qr { display: grid; gap: 12px; }
      .club-deal-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 16px; border: 1px solid rgba(126,234,255,.22); border-radius: 14px; background: rgba(0,0,0,.24); }
      .club-deal-copy { min-width: 0; display: grid; gap: 7px; }
      .club-deal-copy h2 { font-size: 20px; }
      .club-deal-copy p, .club-deal-copy small { color: #b9accd; font-size: 11px; line-height: 1.4; }
      .club-deal-action { display: grid; justify-items: end; gap: 8px; }
      .club-deal-action > button, .venue-qr-launcher { min-height: 44px; padding: 0 15px; border: 1px solid rgba(126,234,255,.4); border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; cursor: pointer; }
      .profile-working-card .club-deal-launcher { width: 100%; min-height: 56px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border-color: rgba(77,236,157,.78); background: linear-gradient(135deg, #075c4d, #10804a); box-shadow: 0 0 26px rgba(77,236,157,.2); }
      .profile-working-card .club-deal-launcher strong { max-width: none; padding: 8px 12px; border-radius: 10px; color: #062015; background: #b7ffd8; }
      .deal-qr-frame { display: grid; justify-items: center; gap: 6px; }
      .deal-qr-frame img { width: 116px; aspect-ratio: 1; border-radius: 10px; background: #fff; }
      .deal-qr-frame span, .club-deal-action em { color: #9fefff; font-size: 10px; font-style: normal; }
      .venue-qr-launcher { width: 100%; display: flex; align-items: center; justify-content: space-between; }
      .venue-qr-launcher span { color: #d8f7ff; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; }
      .profile-deal-availability { margin-top: 0; }
      .venue-qr-unavailable { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; background: rgba(0,0,0,.2); }
      .profile-deal-availability .venue-qr-unavailable { border-color: rgba(167,139,250,.22); background: linear-gradient(135deg, rgba(34,29,47,.58), rgba(8,8,13,.82)); }
      .venue-qr-placeholder-icon { width: 48px; height: 48px; display: grid; place-items: center; padding: 6px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; color: rgba(245,245,255,.52); background: linear-gradient(145deg, rgba(255,255,255,.07), rgba(255,255,255,.025)); box-shadow: inset 0 1px 0 rgba(255,255,255,.04); }
      .venue-qr-placeholder-icon svg { width: 100%; height: 100%; }
      .venue-qr-placeholder-icon .qr-finder { fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: miter; }
      .venue-qr-placeholder-icon .qr-module { fill: currentColor; stroke: none; }
      .venue-qr-unavailable-copy { min-width: 0; display: grid; gap: 4px; }
      .venue-qr-unavailable-copy strong { color: #f5f2ff; font-size: 14px; }
      .venue-qr-unavailable-copy p { color: #a99eb7; font-size: 11px; }
      .venue-qr-explanation { color: #a99eb7; font-size: 10px; }
      .venue-qr-explanation summary { width: fit-content; color: #9fefff; font-size: 10px; font-weight: 850; cursor: pointer; list-style-position: inside; }
      .venue-qr-explanation p { margin-top: 5px; }
      .profile-schedule-section { margin-top: 24px; }
      .profile-media-section { display: grid; gap: 9px; margin-top: 8px; }
      .profile-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .profile-section-heading > div { display: grid; gap: 5px; }
      .profile-section-heading > span { color: #9487a5; font-size: 11px; font-weight: 850; }
      .profile-media-tabs { width: fit-content; display: grid; grid-template-columns: repeat(2, 44px); justify-self: center; gap: 5px; padding: 3px; border: 1px solid rgba(255,255,255,.08); border-radius: 999px; background: rgba(255,255,255,.025); }
      .profile-media-tabs button { width: 44px; height: 44px; min-height: 44px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 50%; color: #91869f; background: transparent; cursor: pointer; }
      .profile-media-tab-icon { width: 22px; height: 22px; display: block; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .profile-media-tab-play { fill: currentColor; stroke: none; }
      .profile-media-tabs button.active { border-color: rgba(126,234,255,.42); color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.38), rgba(11,148,201,.2)); box-shadow: 0 0 20px rgba(124,58,237,.12); text-shadow: none; }
      .profile-media-tabs button:disabled { opacity: .42; cursor: default; }
      .profile-media-feature { position: relative; width: 100%; aspect-ratio: 4 / 5; max-height: 660px; overflow: hidden; border: 1px solid rgba(126,234,255,.22); border-radius: 20px; color: #fff; background: #020204; box-shadow: 0 24px 70px rgba(0,0,0,.42), 0 0 34px rgba(124,58,237,.12); cursor: zoom-in; isolation: isolate; touch-action: pan-y; }
      .profile-media-feature::after { content: ""; position: absolute; z-index: 1; inset: auto 0 0; height: 28%; pointer-events: none; background: linear-gradient(180deg, transparent, rgba(0,0,0,.7)); }
      .profile-media-feature > img, .profile-media-feature > video { width: 100%; height: 100%; display: block; object-fit: cover; background: #000; pointer-events: none; user-select: none; }
      .profile-media-feature > img { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-media-feature:focus-visible { border-color: #7eeaff; outline: 3px solid rgba(126,234,255,.2); outline-offset: 3px; }
      .profile-media-video-controls { position: absolute; z-index: 4; left: 12px; right: 12px; bottom: 54px; display: grid; grid-template-columns: auto auto minmax(52px, 1fr) auto; align-items: center; gap: 7px; padding: 7px; border: 1px solid rgba(255,255,255,.14); border-radius: 13px; background: rgba(4,4,8,.74); box-shadow: 0 10px 28px rgba(0,0,0,.32); backdrop-filter: blur(12px); cursor: default; }
      .profile-media-video-controls button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 0 9px; border: 1px solid rgba(126,234,255,.26); border-radius: 9px; color: #fff; background: rgba(126,234,255,.08); font-size: 10px; font-weight: 900; cursor: pointer; white-space: nowrap; }
      .profile-media-video-controls input { width: 100%; min-width: 48px; accent-color: #7eeaff; cursor: pointer; }
      .profile-media-video-controls output { color: #d8d0e4; font-size: 9px; font-weight: 850; white-space: nowrap; }
      .profile-media-feature-position, .profile-media-feature-expand { position: absolute; z-index: 2; display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: #fff; background: rgba(4,4,8,.68); backdrop-filter: blur(12px); font-size: 10px; font-weight: 900; }
      .profile-media-feature-position { top: 12px; left: 12px; }
      .profile-media-feature-expand { right: 12px; bottom: 12px; cursor: pointer; }
      .profile-media-feature-previous, .profile-media-feature-next { position: absolute; z-index: 3; top: 50%; width: 42px; height: 52px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #fff; background: rgba(4,4,8,.52); font-size: 30px; transform: translateY(-50%); cursor: pointer; backdrop-filter: blur(9px); }
      .profile-media-feature-previous { left: 10px; }
      .profile-media-feature-next { right: 10px; }
      .profile-media-feature-previous:disabled, .profile-media-feature-next:disabled { opacity: 0; pointer-events: none; }
      .profile-media-grid { min-height: 76px; display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; padding: 2px 2px 6px; scroll-snap-type: x proximity; scrollbar-width: thin; touch-action: pan-x pan-y; }
      .profile-media-grid-item { position: relative; width: 64px; min-width: 64px; aspect-ratio: 4 / 5; display: block; flex: 0 0 64px; padding: 0; overflow: hidden; scroll-snap-align: start; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; color: #fff; background: #0b0b10; cursor: pointer; }
      .profile-media-grid-item img, .profile-media-grid-item video { width: 100%; height: 100%; display: block; object-fit: cover; background: #000; pointer-events: none; }
      .profile-media-grid-item img { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-media-grid-item.active { border-color: #7eeaff; box-shadow: 0 0 0 2px rgba(126,234,255,.16), 0 0 16px rgba(34,199,255,.12); }
      .profile-media-grid-item:focus-visible { z-index: 1; outline: 2px solid #7eeaff; outline-offset: 2px; }
      .profile-media-play { position: absolute; top: 50%; left: 50%; width: 30px; aspect-ratio: 1; border-radius: 50%; background: rgba(255,255,255,.86); box-shadow: 0 7px 22px rgba(0,0,0,.36); transform: translate(-50%, -50%); }
      .profile-media-play::after { content: ""; position: absolute; top: 50%; left: 54%; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 9px solid #111; transform: translate(-50%, -50%); }
      .profile-media-duration { position: absolute; right: 6px; bottom: 6px; padding: 4px 6px; border-radius: 999px; color: #fff; background: rgba(0,0,0,.78); font-size: 9px; font-weight: 950; }
      .profile-media-empty { grid-column: 1 / -1; align-self: center; justify-self: center; color: #8f849c; }
      .profile-media-viewer { position: fixed; z-index: 1600; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; color: #fff; background: rgba(0,0,0,.98); overscroll-behavior: none; touch-action: none; }
      .profile-media-viewer-close { position: fixed; z-index: 3; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); width: 50px; height: 50px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: rgba(10,10,14,.78); font-size: 30px; cursor: pointer; backdrop-filter: blur(12px); }
      .profile-media-viewer-stage { position: relative; min-height: 0; display: grid; place-items: center; overflow: hidden; touch-action: none; }
      .profile-media-viewer-stage > img, .profile-media-viewer-stage > video { width: 100%; height: 100%; max-height: 100%; display: block; object-fit: contain; background: #000; user-select: none; }
      .profile-media-viewer-stage > img { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-media-viewer-previous, .profile-media-viewer-next { position: absolute; top: 50%; width: 46px; height: 58px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(5,5,8,.58); font-size: 34px; transform: translateY(-50%); cursor: pointer; backdrop-filter: blur(8px); }
      .profile-media-viewer-previous { left: 12px; }
      .profile-media-viewer-next { right: 12px; }
      .profile-media-viewer-previous:disabled, .profile-media-viewer-next:disabled { opacity: 0; pointer-events: none; }
      .profile-media-viewer-footer { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px max(18px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); border-top: 1px solid rgba(255,255,255,.1); background: #07070a; }
      .profile-media-viewer-footer span { color: #aaa0b8; font-size: 12px; }
      .profile-schedule-section { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(139,92,246,.27); border-radius: 18px; background: rgba(10,10,16,.84); }
      .shift-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
      .shift-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 14px; border: 1px solid rgba(255,255,255,.085); border-radius: 14px; color: #f7f2ff; background: rgba(255,255,255,.035); text-decoration: none; }
      .shift-date { grid-column: 1 / -1; color: #94e5ff; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .shift-row strong { min-width: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .shift-time { color: #b9accd; font-size: 11px; }
      .shift-row em { grid-column: 2; grid-row: 2 / span 2; align-self: center; padding: 6px 9px; border: 1px solid rgba(148,229,255,.22); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.08); font-size: 9px; font-style: normal; font-weight: 950; text-transform: uppercase; }
      .profile-account-gate, .profile-report-gate { position: fixed; inset: 0; z-index: 1700; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.8); backdrop-filter: blur(11px); }
      .profile-account-gate-dialog, .profile-report-dialog { position: relative; width: min(430px, 100%); max-height: calc(100dvh - 24px); display: grid; gap: 14px; padding: 24px; overflow-y: auto; border: 1px solid rgba(53,216,255,.42); border-radius: 16px; background: linear-gradient(145deg, #0b0b13, #060609); box-shadow: 0 28px 90px rgba(0,0,0,.72); }
      .profile-account-gate-dialog > span, .profile-report-dialog > span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .profile-account-gate-dialog h2, .profile-report-dialog h2 { padding-right: 40px; }
      .profile-account-gate-dialog > div { display: grid; gap: 10px; }
      .profile-account-gate-dialog a, .profile-report-dialog form > button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; text-decoration: none; }
      .profile-account-gate-dialog a.secondary { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); }
      .profile-account-gate-close, .profile-report-close { position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(53,216,255,.42); border-radius: 50%; color: #fff; background: #08080d; font-size: 26px; cursor: pointer; }
      .profile-report-dialog form, .profile-report-dialog label { display: grid; gap: 8px; }
      .profile-report-dialog form { gap: 13px; }
      .profile-report-dialog label { color: #e9e2f4; font-size: 13px; font-weight: 900; }
      .profile-report-dialog select, .profile-report-dialog textarea { width: 100%; padding: 11px; border: 1px solid rgba(139,92,246,.35); border-radius: 11px; color: #fff; background: rgba(255,255,255,.055); }
      .profile-report-dialog option { color: #111; }
      .profile-report-error { color: #ffb4c8; }
      @media (max-width: 600px) {
        .public-profile-shell { padding: 0 12px 32px; }
        .profile-titlebar { min-height: 60px; }
        .profile-titlebar-avatar { width: 40px; height: 40px; flex-basis: 40px; }
        .live-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .profile-action-share-slot .profile-share > span { position: absolute; width: 1px; height: 1px; overflow: hidden; }
        .profile-working-card { padding: 16px; }
        .profile-working-head { align-items: start; flex-direction: column; }
        .club-deal-card { grid-template-columns: 1fr; }
        .club-deal-action { justify-items: stretch; }
        .deal-qr-frame { justify-items: center; }
        .profile-media-feature { max-height: min(64dvh, 540px); border-radius: 17px; }
        .profile-media-video-controls { left: 9px; right: 9px; bottom: 52px; gap: 5px; padding: 6px; }
        .profile-media-video-controls button { min-height: 32px; padding-inline: 7px; font-size: 9px; }
        .profile-media-video-controls output { font-size: 8px; }
        .profile-media-feature-previous, .profile-media-feature-next { width: 38px; height: 48px; font-size: 28px; }
        .profile-media-feature-expand { right: 10px; bottom: 10px; }
        .profile-media-viewer-previous, .profile-media-viewer-next { width: 40px; height: 50px; font-size: 30px; }
        .shift-list { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
