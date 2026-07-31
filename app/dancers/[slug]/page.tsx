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
  DancerNotificationCount,
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
          <div className="profile-titlebar-identity">
            <div>
              <h1>{profile.stageName}</h1>
              <span className="profile-verified" aria-label="Verified dancer">
                ✓
              </span>
            </div>
            <span>{profile.city}</span>
          </div>
          <ProfileCloseButton
            fallbackHref={`/?city=${encodeURIComponent(profile.city)}&view=tonight`}
          />
        </header>

        <section className="profile-overview" aria-label={`${profile.stageName} profile summary`}>
          <div
            aria-label={`${profile.stageName} profile photo`}
            className={`profile-avatar${heroPhoto ? " has-photo" : ""}`}
            role="img"
            style={heroPhoto ? { backgroundImage: `url("${heroPhoto}")` } : undefined}
          >
            {!heroPhoto ? initials(profile.stageName) : null}
          </div>
          <dl className="profile-metrics" aria-label="Profile activity">
            <div>
              <dd><DancerFollowerCount /></dd>
              <dt>Followers</dt>
            </div>
            <div>
              <dd><DancerNotificationCount /></dd>
              <dt>Notifications</dt>
            </div>
            <div>
              <dd><DancerGoingCount /></dd>
              <dt>Going</dt>
            </div>
          </dl>
        </section>

        {profile.socialLinks.length ? (
          <section className="profile-social-section" aria-label="Approved social links">
            <SocialLinks dancerId={profile.id} links={profile.socialLinks} />
          </section>
        ) : null}

        <DancerProfileActions
          dancerId={profile.id}
          profileName={profile.stageName}
          shareControl={<ProfileShareButton stageName={profile.stageName} />}
          shifts={profile.upcomingShifts.map((shift) => ({
            id: shift.id,
            label: shortShiftLabel(shift.startsAt, shift.timezone),
            isActive: isActiveNow(shift),
          }))}
        />

        {activeShift ? (
          <section className="profile-working-card" aria-labelledby="profile-working-title">
            <div className="profile-working-head">
              <div>
                <span className="profile-live-state">Working now</span>
                <h2 id="profile-working-title">{activeShift.venueName}</h2>
                <p>
                  Verified check-in · until{" "}
                  {formatShiftTime(activeShift.endsAt, activeShift.timezone)}
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
                  sectionId="club-deal"
                />
              ) : (
                <VenueQrUnavailable venueName={activeShift.venueName} />
              )}
            </div>
          </section>
        ) : null}

        <DancerPhotoCarousel
          photos={gallery.map((photo) => ({
            id: photo.id,
            imageUrl: photo.imageUrl,
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
      .profile-titlebar { position: sticky; z-index: 90; top: 0; max-width: 760px; min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: 0 auto; padding: max(10px, env(safe-area-inset-top)) 0 10px; border-bottom: 1px solid rgba(126,234,255,.14); background: linear-gradient(180deg, rgba(5,5,8,.98), rgba(5,5,8,.9)); backdrop-filter: blur(22px); }
      .profile-titlebar-identity { min-width: 0; display: grid; gap: 2px; }
      .profile-titlebar-identity > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
      .profile-titlebar h1 { margin: 0; overflow: hidden; font-size: clamp(21px, 4vw, 29px); line-height: 1; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
      .profile-titlebar-identity > span { overflow: hidden; color: #b9accd; font-size: 12px; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
      .profile-verified { width: 22px; height: 22px; flex: 0 0 22px; display: inline-grid; place-items: center; border-radius: 50%; color: #051019; background: #7eeaff; box-shadow: 0 0 17px rgba(126,234,255,.34); font-size: 13px; font-weight: 950; }
      .public-profile-close { width: 44px; min-height: 44px; display: inline-grid; flex: 0 0 44px; place-items: center; padding: 0; border: 1px solid rgba(126,234,255,.36); border-radius: 50%; color: #fff; background: rgba(10,10,14,.84); box-shadow: 0 0 18px rgba(124,58,237,.16); font-size: 28px; line-height: 1; cursor: pointer; }
      .public-profile-close:hover, .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13), 0 0 22px rgba(34,199,255,.18); }
      .profile-overview, .profile-social-section, .live-actions, .profile-working-card, .profile-media-section, .profile-schedule-section { width: min(100%, 760px); margin-inline: auto; }
      .profile-overview { display: grid; grid-template-columns: clamp(96px, 18vw, 132px) minmax(0, 1fr); align-items: center; gap: clamp(18px, 5vw, 42px); padding: 22px 0 18px; }
      .profile-avatar { width: 100%; aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; border: 2px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgba(124,58,237,.72), rgba(34,199,255,.35)); box-shadow: 0 18px 44px rgba(0,0,0,.38), 0 0 28px rgba(124,58,237,.2); background-position: center; background-size: cover; font-size: 30px; font-weight: 950; }
      .profile-avatar.has-photo { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; }
      .profile-metrics > div { min-width: 0; display: grid; gap: 4px; justify-items: center; padding: 10px 4px; }
      .profile-metrics dd { margin: 0; color: #fff; font-size: clamp(20px, 4vw, 28px); font-weight: 950; line-height: 1; }
      .profile-metrics dt { color: #afa5bd; font-size: clamp(9px, 2.2vw, 12px); font-weight: 850; text-align: center; }
      .profile-social-section { padding: 2px 0 16px; }
      .social-links-control { display: grid; gap: 10px; }
      .social-list { display: flex; flex-wrap: wrap; gap: 8px; }
      .social-list a { min-height: 38px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid rgba(139,92,246,.3); border-radius: 999px; color: #fff; background: rgba(139,92,246,.09); font-size: 11px; text-decoration: none; }
      .social-list a span { color: #b9accd; }
      .social-list-toggle { min-height: 36px; justify-self: start; padding: 0 12px; border: 1px solid rgba(126,234,255,.25); border-radius: 999px; color: #9fefff; background: rgba(34,199,255,.07); font-size: 11px; font-weight: 900; cursor: pointer; }
      .live-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding-bottom: 20px; }
      .live-actions > button, .profile-action-share-slot .profile-share button { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 7px 10px; border: 1px solid rgba(148,229,255,.24); border-radius: 12px; color: #fff; background: rgba(148,229,255,.075); cursor: pointer; font-size: 12px; font-weight: 900; text-align: center; }
      .live-actions > button:disabled { opacity: .66; cursor: wait; }
      .live-actions .profile-action-primary { flex-direction: column; gap: 2px; border-color: rgba(126,234,255,.48); background: linear-gradient(135deg, rgba(109,40,217,.86), rgba(11,148,201,.74)); }
      .live-actions .profile-action-primary.profile-action-unavailable { border-color: rgba(148,137,166,.3); color: #bdb4ca; background: rgba(255,255,255,.055); }
      .profile-action-requires-account { flex-direction: column; gap: 1px; }
      .profile-action-requirement { color: #c7bbd8; font-size: 8px; font-weight: 850; line-height: 1.1; }
      .profile-action-share-slot { min-width: 0; }
      .profile-action-share-slot .profile-share { display: block; min-height: 48px; }
      .profile-action-share-slot .profile-share button { gap: 6px; }
      .profile-action-share-slot .profile-share svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; }
      .profile-action-share-slot .profile-share > span { display: block; color: #9fefff; font-size: 9px; text-align: center; }
      .live-actions .profile-action-report { grid-column: 1 / -1; min-height: 30px; justify-self: end; width: fit-content; padding-inline: 4px; border: 0; color: #958aa4; background: transparent; font-size: 11px; text-decoration: underline; }
      .profile-action-status { grid-column: 1 / -1; color: #94e5ff; font-size: 12px; font-weight: 850; }
      .profile-working-card { display: grid; gap: 16px; padding: 20px; border: 1px solid rgba(126,234,255,.38); border-radius: 18px; background: radial-gradient(circle at 88% 8%, rgba(34,199,255,.14), transparent 16rem), linear-gradient(145deg, rgba(29,11,67,.94), rgba(7,11,18,.96)); box-shadow: 0 22px 70px rgba(0,0,0,.38), 0 0 28px rgba(34,199,255,.1); }
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
      .deal-qr-frame { display: grid; justify-items: center; gap: 6px; }
      .deal-qr-frame img { width: 116px; aspect-ratio: 1; border-radius: 10px; background: #fff; }
      .deal-qr-frame span, .club-deal-action em { color: #9fefff; font-size: 10px; font-style: normal; }
      .venue-qr-launcher { width: 100%; display: flex; align-items: center; justify-content: space-between; }
      .venue-qr-launcher span { color: #d8f7ff; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; }
      .venue-qr-unavailable { display: grid; gap: 5px; padding: 14px; border: 1px dashed rgba(255,255,255,.16); border-radius: 12px; background: rgba(0,0,0,.2); }
      .profile-media-section, .profile-schedule-section { margin-top: 24px; }
      .profile-media-section { display: grid; gap: 12px; }
      .profile-media-heading, .profile-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
      .profile-media-heading > div, .profile-section-heading > div { display: grid; gap: 5px; }
      .profile-media-heading > span, .profile-section-heading > span { color: #9487a5; font-size: 11px; font-weight: 850; }
      .profile-media-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-bottom: 1px solid rgba(255,255,255,.1); }
      .profile-media-tabs button { min-height: 46px; border: 0; border-bottom: 2px solid transparent; color: #91869f; background: transparent; font-weight: 950; cursor: pointer; }
      .profile-media-tabs button span { color: #6f657c; font-size: 10px; }
      .profile-media-tabs button.active { border-bottom-color: #7eeaff; color: #fff; text-shadow: 0 0 16px rgba(126,234,255,.32); }
      .profile-media-tabs button:disabled { opacity: .42; cursor: default; }
      .profile-media-grid { min-height: 110px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
      .profile-media-grid-item { position: relative; aspect-ratio: 1; display: block; padding: 0; overflow: hidden; border: 0; color: #fff; background: #0b0b10; cursor: pointer; }
      .profile-media-grid-item img, .profile-media-grid-item video { width: 100%; height: 100%; display: block; object-fit: cover; background: #000; pointer-events: none; }
      .profile-media-grid-item img { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-media-grid-item:focus-visible { z-index: 1; outline: 2px solid #7eeaff; outline-offset: -2px; }
      .profile-media-play { position: absolute; top: 50%; left: 50%; width: 42px; aspect-ratio: 1; border-radius: 50%; background: rgba(255,255,255,.86); box-shadow: 0 7px 22px rgba(0,0,0,.36); transform: translate(-50%, -50%); }
      .profile-media-play::after { content: ""; position: absolute; top: 50%; left: 54%; border-top: 8px solid transparent; border-bottom: 8px solid transparent; border-left: 12px solid #111; transform: translate(-50%, -50%); }
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
        .profile-titlebar { min-height: 66px; }
        .profile-overview { grid-template-columns: 94px minmax(0, 1fr); gap: 12px; padding-top: 16px; }
        .live-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .profile-action-share-slot .profile-share > span { position: absolute; width: 1px; height: 1px; overflow: hidden; }
        .profile-working-card { padding: 16px; }
        .profile-working-head { align-items: start; flex-direction: column; }
        .club-deal-card { grid-template-columns: 1fr; }
        .club-deal-action { justify-items: stretch; }
        .deal-qr-frame { justify-items: center; }
        .profile-media-grid { gap: 2px; }
        .profile-media-viewer-previous, .profile-media-viewer-next { width: 40px; height: 50px; font-size: 30px; }
        .shift-list { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}
