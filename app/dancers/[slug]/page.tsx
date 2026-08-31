import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { UberRideButton } from "@/app/components/UberRideButton";
import { createDancerDealAttributionToken } from "@/src/lib/dancr/deal-attribution";
import { getActiveClubDealsForVenue } from "@/src/lib/dancr/deals";
import { imageFocalPointCss } from "@/src/lib/dancr/image-focal-point";
import { MAX_DANCER_PROFILE_VIDEOS } from "@/src/lib/dancr/media-limits";
import { getDancerProfile, getVenueProfile } from "@/src/lib/dancr/public";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import { isActiveNfcPresence } from "@/src/lib/dancr/shift-presence";
import type { ShiftSummary } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import {
  DancerFollowerMetric,
  DancerFollowStateProvider,
  DancerGoingCount,
  DancerProfileActions,
  DancerReportControl,
} from "./DancerProfileActions";
import { DancerDirectionsButton } from "./DancerDirectionsButton";
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
  const heroPhotoFocalX =
    profile.primaryPhotoFocalX ?? profile.photos[0]?.focalX ?? 50;
  const heroPhotoFocalY =
    profile.primaryPhotoFocalY ?? profile.photos[0]?.focalY ?? 50;
  const avatarPhoto = profile.avatarPhotoUrl || heroPhoto;
  const avatarPhotoSrcSet = profile.avatarPhotoSrcSet || heroPhotoSrcSet;
  const avatarPhotoWidth = profile.avatarPhotoWidth || heroPhotoWidth;
  const avatarPhotoHeight = profile.avatarPhotoHeight || heroPhotoHeight;
  const avatarPhotoFocalX = profile.avatarPhotoFocalX ?? heroPhotoFocalX;
  const avatarPhotoFocalY = profile.avatarPhotoFocalY ?? heroPhotoFocalY;
  const gallery = profile.photos.length
    ? profile.photos
    : heroPhoto
      ? [{ id: "primary", imageUrl: heroPhoto, isPrimary: true, sortOrder: 0 }]
      : [];
  const activeShift = profile.upcomingShifts.find((shift) => isActiveNow(shift));
  const upcomingShifts = profile.upcomingShifts.filter(
    (shift) => shift.id !== activeShift?.id,
  );
  const hasUpcomingShift = !activeShift && upcomingShifts.length > 0;
  const actionShift = activeShift || upcomingShifts[0] || null;
  const [activeDeals, tvVideos, actionVenue] = await Promise.all([
    activeShift?.venueId
      ? getActiveClubDealsForVenue(client, activeShift.venueId)
      : Promise.resolve([]),
    getPublicMyDancrTvFeed(client, {
      city: profile.city,
      dancerId: profile.id,
      limit: MAX_DANCER_PROFILE_VIDEOS,
    }),
    actionShift?.venueSlug
      ? getVenueProfile(client, actionShift.venueSlug)
      : Promise.resolve(null),
  ]);
  const activeDeal = activeDeals[0] || null;
  const dancerAttributionEligible = Boolean(
    activeShift && activeShift.shiftSource !== "demo_locked",
  );
  const dealAttributionTokens = activeShift && dancerAttributionEligible
    ? Object.fromEntries(activeDeals.map((deal) => [deal.id, createDancerDealAttributionToken({
        dancerId: profile.id,
        venueId: activeShift.venueId,
        dealId: deal.id,
        shiftId: activeShift.id,
      })]))
    : {};
  const dealAttributionToken = activeDeal ? dealAttributionTokens[activeDeal.id] : null;
  const dealSourceType = dancerAttributionEligible ? "dancer_profile" : "club_page";

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
          <div className="profile-titlebar-person">
            <div
              aria-label={`${profile.stageName} profile photo${activeShift ? ", working now" : hasUpcomingShift ? ", upcoming shift posted" : ""}`}
              className={`profile-titlebar-avatar${avatarPhoto ? " has-photo" : ""}`}
              data-dancer-avatar=""
              data-upcoming={hasUpcomingShift ? "true" : undefined}
              data-working-now={activeShift ? "true" : undefined}
              role="img"
            >
              <span aria-hidden="true" data-dancer-avatar-border="">
                {avatarPhoto ? (
                  <img
                    alt=""
                    decoding="async"
                    fetchPriority="high"
                    height={avatarPhotoHeight || undefined}
                    sizes="72px"
                    src={avatarPhoto}
                    srcSet={avatarPhotoSrcSet || undefined}
                    style={{
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: imageFocalPointCss(avatarPhotoFocalX, avatarPhotoFocalY),
                      width: "100%",
                    }}
                    width={avatarPhotoWidth || undefined}
                  />
                ) : initials(profile.stageName)}
              </span>
              {activeShift ? <span aria-hidden="true" data-working-now-indicator="">NOW</span> : null}
            </div>
            <div className="profile-titlebar-identity">
              <div>
                <h1>{profile.stageName}</h1>
              </div>
              <div className="profile-titlebar-context">
                <span className="profile-titlebar-city">{profile.city}</span>
              </div>
            </div>
          </div>
          <dl className="profile-header-metrics" aria-label="Profile activity">
            <div>
              <DancerFollowerMetric />
            </div>
            <div>
              <dd><DancerGoingCount /></dd>
              <dt>Going</dt>
            </div>
            <div>
              <dd>{new Intl.NumberFormat("en-US").format(profile.profileViewsToday || 0)}</dd>
              <dt>Views today</dt>
            </div>
          </dl>
          <div className="profile-titlebar-controls">
            <ProfileCloseButton
              fallbackHref={`/?city=${encodeURIComponent(profile.city)}&view=dancers`}
            />
          </div>
        </header>

        <DancerProfileActions
          dancerId={profile.id}
          shareControl={<ProfileShareButton dancerId={profile.id} stageName={profile.stageName} />}
          shifts={profile.upcomingShifts.map((shift) => ({
            id: shift.id,
            label: shortShiftLabel(shift.shiftDate || shift.startsAt, shift.timezone),
            isActive: isActiveNow(shift),
          }))}
        />

        <section
          aria-label="Tonight"
          className={`profile-tonight-card${activeShift ? " is-now" : ""}${!activeShift && upcomingShifts.length ? " is-upcoming" : ""}${!activeShift && !upcomingShifts.length ? " is-no-schedule" : ""}${activeDeal ? " has-club-deal" : ""}${!activeShift && actionShift ? " has-venue-deal-link" : ""}`}
          data-profile-deal-state={activeDeal ? "available" : actionShift ? "available-after-check-in" : "none"}
          data-profile-shift-state={activeShift ? "now" : actionShift ? "upcoming" : "no-schedule"}
        >
          {activeShift ? (
          <div
            className="profile-shift-card profile-working-card is-now"
            aria-labelledby="profile-working-title"
          >
            <div className="profile-working-head">
              <Link
                className="profile-working-destination"
                href={`/venues/${encodeURIComponent(activeShift.venueSlug)}`}
              >
                <span className="profile-live-state" id="profile-working-title">Working now</span>
                <span className="profile-working-copy">
                  <VenuePinIcon />
                  <strong>{activeShift.venueName}</strong>
                </span>
                <span aria-hidden="true" className="profile-working-cue">›</span>
              </Link>
            </div>
          </div>
          ) : upcomingShifts.length ? (
          <div
            className="profile-shift-card profile-upcoming-card is-upcoming"
            aria-labelledby="profile-schedule-title"
          >
            <div className="profile-upcoming-list">
              {upcomingShifts.map((shift, index) => (
                <Link
                  className="profile-upcoming-destination"
                  href={`/venues/${encodeURIComponent(shift.venueSlug)}`}
                  key={shift.id}
                >
                  <span
                    className="profile-upcoming-state"
                    id={index === 0 ? "profile-schedule-title" : undefined}
                  >
                    Upcoming · {formatShiftDate(shift.shiftDate || shift.startsAt, shift.timezone)}
                  </span>
                  <span className="profile-upcoming-copy">
                    <VenuePinIcon />
                    <strong>{shift.venueName}</strong>
                  </span>
                  <span aria-hidden="true" className="profile-upcoming-cue">›</span>
                </Link>
              ))}
            </div>
          </div>
          ) : (
          <div className="profile-shift-card profile-schedule-empty is-empty" aria-label="Schedule status">
            <span className="profile-empty-state">No shift posted</span>
            <span className="profile-empty-copy">
              <em>Follow {profile.stageName} for updates</em>
            </span>
          </div>
          )}

          {activeShift && activeDeal ? (
            <div className="profile-tonight-deal">
              <div
                className="profile-active-deal has-club-deal"
                aria-label="Active Club Deal for cashier tap"
              >
                <ClubDealCard
                  deal={activeDeal}
                  deals={activeDeals}
                  venueId={activeShift.venueId}
                  venueName={activeShift.venueName}
                  sourceType={dealSourceType}
                  dancerId={dancerAttributionEligible ? profile.id : null}
                  attributionToken={dealAttributionToken}
                  attributionTokens={dealAttributionTokens}
                  dancerNote={dancerAttributionEligible}
                  presentation="profileCompact"
                  ctaLabel={activeDeals.length > 1 ? "Club Deals" : "Club Deal"}
                  sectionId="club-deal"
                />
              </div>
            </div>
          ) : actionShift ? (
            <div className="profile-tonight-deal">
              <p className="profile-deal-availability-line">
                {activeShift ? "No active club deal" : "Going tonight? View the Club Deal"}
              </p>
            </div>
          ) : null}

          {actionVenue ? (
            <div
              aria-label="Venue travel actions"
              className={`profile-tonight-travel-actions${activeShift ? " is-working-now" : " is-upcoming has-venue-deal-link"}`}
            >
              <DancerDirectionsButton dancerId={profile.id} venue={actionVenue} />
              <UberRideButton
                compact
                dancerId={profile.id}
                source="dancer_profile"
                venue={{ ...actionVenue, isActive: true, isPublic: true }}
              />
              {!activeShift && actionShift ? (
                <Link
                  aria-label={`View Club Deals on ${actionShift.venueName}'s venue page`}
                  className="profile-upcoming-venue-deal"
                  data-upcoming-venue-deal="venue-page"
                  href={`/venues/${encodeURIComponent(actionShift.venueSlug)}`}
                >
                  <VenuePageIcon />
                  <span>View Deal</span>
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>

        <DancerPhotoCarousel
          dancerId={profile.id}
          photos={gallery.map((photo) => ({
            id: photo.id,
            imageUrl: photo.imageUrl,
            imageSrcSet: photo.imageSrcSet,
            imageWidth: photo.imageWidth,
            imageHeight: photo.imageHeight,
            likeCount: photo.likeCount || 0,
          }))}
          videos={tvVideos.map((video) => ({
            id: video.id,
            videoUrl: video.videoUrl,
            posterUrl: video.posterUrl || null,
            durationSeconds: video.durationSeconds,
            likeCount: video.likeCount,
          }))}
          socialContent={profile.socialLinks.length ? (
            <SocialLinks dancerId={profile.id} links={profile.socialLinks} showHeading={false} />
          ) : null}
          stageName={profile.stageName}
          viewerStatus={activeShift
            ? "Working Now"
            : actionShift
              ? `Upcoming · ${formatShiftDate(actionShift.shiftDate || actionShift.startsAt, actionShift.timezone)}`
              : "No shift posted"}
        />

        <DancerReportControl dancerId={profile.id} profileName={profile.stageName} />

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
  return isActiveNfcPresence(shift);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function VenuePinIcon() {
  return (
    <svg aria-hidden="true" className="profile-venue-pin" viewBox="0 0 24 24">
      <path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.4" />
    </svg>
  );
}

function VenuePageIcon() {
  return (
    <svg aria-hidden="true" className="profile-venue-page-icon" viewBox="0 0 24 24">
      <path d="M5 20V9l7-4 7 4v11" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function PublicProfileStyles() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, input, select, textarea { font: inherit; }
      .public-profile-shell { min-height: 100vh; padding: 0 clamp(18px, 4vw, 56px) max(64px, calc(32px + env(safe-area-inset-bottom))); background: radial-gradient(circle at 78% 8%, rgba(139,92,246,.22), transparent 28rem), linear-gradient(180deg, #090911, #050507 62%); }
      html:has(.public-profile-shell), body:has(.public-profile-shell) { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.28) transparent; }
      html:has(.public-profile-shell)::-webkit-scrollbar, body:has(.public-profile-shell)::-webkit-scrollbar { width: 4px; }
      html:has(.public-profile-shell)::-webkit-scrollbar-track, body:has(.public-profile-shell)::-webkit-scrollbar-track { border: 0; background: transparent; }
      html:has(.public-profile-shell)::-webkit-scrollbar-thumb, body:has(.public-profile-shell)::-webkit-scrollbar-thumb { border: 0; border-radius: 999px; background: rgba(255,255,255,.28); box-shadow: none; }
      html:has(.public-profile-shell)::-webkit-scrollbar-thumb:hover, html:has(.public-profile-shell)::-webkit-scrollbar-thumb:active, body:has(.public-profile-shell)::-webkit-scrollbar-thumb:hover, body:has(.public-profile-shell)::-webkit-scrollbar-thumb:active { background: rgba(255,255,255,.42); box-shadow: none; }
      .profile-titlebar { position: relative; z-index: 10; max-width: 760px; min-height: 64px; display: grid; grid-template-columns: minmax(120px, .95fr) minmax(150px, 1.05fr) 44px; align-items: center; gap: 6px; margin: 0 auto; padding: max(6px, env(safe-area-inset-top)) 0 6px; border-bottom: 0; background: radial-gradient(circle at 14% 0%, rgba(126,234,255,.055), transparent 11rem), linear-gradient(180deg, rgba(5,5,8,.98), rgba(5,5,8,.92)); box-shadow: 0 8px 24px rgba(0,0,0,.2); backdrop-filter: blur(22px); }
      .profile-titlebar-person { min-width: 0; display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: center; gap: 9px; }
      .profile-titlebar-avatar { width: 48px; height: 48px; position: relative; display: grid; place-items: center; overflow: hidden; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgba(124,58,237,.72), rgba(34,199,255,.35)); box-shadow: 0 10px 26px rgba(0,0,0,.36), 0 0 18px rgba(124,58,237,.15); font-size: 13px; font-weight: 950; }
      .profile-titlebar-avatar.has-photo { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-titlebar-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; background: radial-gradient(circle at 68% 20%, rgba(126,234,255,.16), transparent 34%), linear-gradient(145deg, rgba(109,40,217,.38), #08080d); filter: brightness(1.14) contrast(1.03); }
      .profile-titlebar-identity { min-width: 0; display: grid; align-content: center; gap: 2px; overflow: hidden; }
      .profile-titlebar-identity > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
      .profile-titlebar h1 { margin: 0; overflow: hidden; font-size: clamp(20px, 4vw, 26px); line-height: 1.05; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
      .profile-titlebar-identity > .profile-titlebar-context { gap: 5px; overflow: hidden; }
      .profile-titlebar-status { min-height: 20px; display: inline-flex; flex: 0 0 auto; align-items: center; padding: 0 7px; border: 1px solid rgba(126,234,255,.3); border-radius: 999px; color: #b9f6ff; background: rgba(126,234,255,.08); font-size: 8px; font-weight: 950; letter-spacing: .04em; line-height: 1; text-transform: uppercase; white-space: nowrap; }
      .profile-titlebar-status.is-live { border-color: rgba(77,236,157,.54); color: #b7ffd8; background: rgba(23,137,82,.18); box-shadow: 0 0 14px rgba(77,236,157,.12); }
      .profile-titlebar-status.is-empty { border-color: rgba(180,169,196,.2); color: #a99eb7; background: rgba(255,255,255,.035); }
      .profile-titlebar-context a, .profile-titlebar-city { min-width: 0; overflow: hidden; color: #c8bfd6; font-size: 10px; font-weight: 850; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
      .profile-titlebar-city { min-height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border: 1px solid rgba(180,169,196,.14); border-radius: 999px; background: rgba(255,255,255,.035); }
      .profile-titlebar-context a:hover, .profile-titlebar-context a:focus-visible { color: #9fefff; outline: none; text-decoration: underline; text-underline-offset: 3px; }
      .profile-header-metrics { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0; padding: 0; }
      .profile-header-metrics > div { min-width: 0; min-height: 42px; display: grid; grid-template-rows: 22px 14px; align-content: center; gap: 1px; justify-items: center; padding: 2px 1px; }
      .profile-header-metrics dd { max-width: 100%; margin: 0; overflow: hidden; color: #eee9f5; font-size: clamp(16px, 3.4vw, 21px); font-variant-numeric: tabular-nums; font-weight: 900; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
      .profile-header-metrics dt { max-width: 100%; overflow: hidden; color: #8f849c; font-size: clamp(8px, 1.9vw, 10px); font-weight: 850; line-height: 1.15; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
      .profile-titlebar-controls { width: 44px; display: grid; grid-template-columns: 44px; align-items: center; align-self: start; justify-self: end; }
      .profile-footer-report { width: min(100%, 760px); display: flex; justify-content: center; margin: 0 auto; padding: 9px 0 4px; }
      .profile-footer-report-toggle { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 7px 10px; border: 0; border-radius: 999px; color: rgba(189,180,200,.46); background: transparent; box-shadow: none; font-size: 9px; font-weight: 750; line-height: 1; cursor: pointer; }
      .profile-footer-report-toggle svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .profile-footer-report-toggle:hover, .profile-footer-report-toggle:focus-visible { color: rgba(225,219,232,.82); background: rgba(255,255,255,.035); outline: none; }
      .profile-footer-report-toggle:disabled { cursor: default; opacity: .58; }
      .public-profile-close { position: static; width: 44px; min-height: 44px; display: inline-grid; place-items: center; padding: 0; border: 1px solid rgba(180,169,196,.2); border-radius: 50%; color: #fff; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 10px 24px rgba(0,0,0,.28); font-size: 26px; line-height: 1; cursor: pointer; }
      .public-profile-close:hover, .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13), 0 0 22px rgba(34,199,255,.18); }
      .profile-report-confirmation { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .profile-media-socials, .live-actions, .profile-working-card, .profile-active-deal, .profile-deal-availability, .profile-media-section, .profile-schedule-section, .profile-schedule-empty, .profile-tonight-card { width: min(100%, 760px); margin-inline: auto; }
      .profile-schedule-empty { min-width: 0; display: flex; align-items: center; gap: 6px; margin-top: 5px; padding: 8px 10px; overflow: hidden; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; color: #82798c; background: rgba(255,255,255,.025); font-size: 10px; line-height: 1.2; }
      .profile-schedule-empty strong { flex: 0 0 auto; color: #d9d3e0; font-size: 12px; white-space: nowrap; }
      .profile-schedule-empty > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-media-socials { min-height: 0; display: grid; place-items: center; margin: 0; padding: 10px 0 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .social-links-control { display: grid; justify-items: center; gap: 0; text-align: center; }
      .social-list-heading { display: grid; justify-items: center; gap: 3px; }
      .social-list-heading > span { color: #94e5ff; font-size: 9px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .social-list-heading h2 { margin: 0; font-size: 15px; line-height: 1.1; }
      .social-list { width: fit-content; max-width: 100%; display: flex; flex-wrap: nowrap; align-items: center; justify-content: center; gap: 6px; margin-inline: auto; overflow: visible; scrollbar-width: none; }
      .social-list::-webkit-scrollbar { display: none; }
      .social-list a { position: relative; width: 44px; min-width: 44px; height: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; padding: 0; border: 0; border-radius: 50%; color: #f4f4f6; background: transparent; box-shadow: none; text-decoration: none; transition: transform .16s ease; }
      .social-list a::before { content: ""; position: absolute; inset: 3px; border: 1px solid rgba(226,232,240,.11); border-radius: 50%; background: rgba(9,9,13,.86); box-shadow: none; transition: border-color .16s ease, background .16s ease; }
      .social-list a:hover { transform: translateY(-1px); }
      .social-list a:hover::before { border-color: rgba(226,232,240,.2); background: rgba(17,17,22,.92); box-shadow: none; }
      .social-list a:focus-visible { outline: none; }
      .social-list a:focus-visible::before { border-color: #7eeaff; outline: 2px solid rgba(126,234,255,.72); outline-offset: 2px; }
      .social-list a svg { position: relative; z-index: 1; width: 19px; height: 19px; display: block; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .social-list a.social-link-instagram svg { fill: none; }
      .social-list a.social-link-x svg { fill: currentColor; stroke: none; }
      .social-list a.social-link-instagram { color: #e4405f; }
      .social-list a.social-link-tiktok { color: #25f4ee; }
      .social-list a.social-link-snapchat { color: #fffc00; }
      .social-list a.social-link-onlyfans { color: #00aff0; }
      .social-list a.social-link-x { color: #f4f4f6; }
      .social-list a .logo-cutout { fill: #0d0a17; stroke: none; }
      @media (prefers-reduced-motion: reduce) { .social-list a { transition: none; } }
      .live-actions { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 0; row-gap: 2px; margin: 0 auto 12px; padding: 4px 0 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .live-actions.is-no-live-shift { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .live-actions > button, .profile-action-share-slot .profile-share button { width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 6px 8px; border: 1px solid rgba(148,229,255,.2); border-radius: 11px; color: #fff; background: rgba(148,229,255,.055); cursor: pointer; font-size: 11px; font-weight: 900; text-align: center; }
      .live-actions > button:disabled { opacity: .66; cursor: wait; }
      .live-actions > button.profile-action-unavailable:disabled { opacity: .7; cursor: default; }
      .live-actions .profile-action-unavailable { flex-direction: column; gap: 1px; border-color: rgba(148,137,166,.22); color: #958b9f; background: rgba(255,255,255,.03); box-shadow: none; }
      .live-actions .profile-action-unavailable .profile-action-requirement { color: #83798d; }
      .live-actions .profile-action-primary { border-color: rgba(126,234,255,.48); background: linear-gradient(135deg, rgba(109,40,217,.86), rgba(11,148,201,.74)); box-shadow: 0 12px 30px rgba(49,46,129,.2), 0 0 18px rgba(34,199,255,.08); }
      .live-actions .profile-action-primary.profile-action-unavailable { border-color: rgba(148,137,166,.3); color: #bdb4ca; background: rgba(255,255,255,.055); }
      .live-actions .profile-action-going.profile-action-secondary { border-color: rgba(148,229,255,.26); background: linear-gradient(135deg, rgba(38,31,56,.82), rgba(18,33,44,.76)); box-shadow: none; }
      .live-actions .profile-action-going.is-going { border-color: rgba(77,236,157,.42); color: #b7ffd8; background: rgba(77,236,157,.1); }
      .profile-action-requires-account { flex-direction: column; gap: 1px; }
      .profile-action-requirement { color: #c7bbd8; font-size: 8px; font-weight: 850; line-height: 1.1; }
      .profile-action-main { min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
      .profile-action-main > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-action-icon-frame { width: 15px; height: 15px; display: inline-grid; flex: 0 0 15px; place-items: center; }
      .profile-action-preview-icon { --profile-icon-offset-x: 0px; --profile-icon-offset-y: 0px; width: 15px; height: 15px; display: block; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transform: translate(var(--profile-icon-offset-x), var(--profile-icon-offset-y)); transform-origin: center; }
      .profile-action-icon-frame[data-profile-action-icon="personPlus"] .profile-action-preview-icon { width: 16.25px; height: 16.25px; }
      .profile-action-icon-frame[data-profile-action-icon="bell"] .profile-action-preview-icon { width: 13.75px; height: 13.75px; }
      .profile-action-icon-frame[data-profile-action-icon="clock"] .profile-action-preview-icon { width: 15.25px; height: 15.25px; }
      .profile-action-icon-frame[data-profile-action-icon="share"] .profile-action-preview-icon { width: 13px; height: 13px; }
      body.dancr-button-system .public-profile-shell .live-actions > button.profile-action-icon-control, body.dancr-button-system .public-profile-shell .profile-action-share-slot .profile-share > button.profile-action-icon-control { min-height: 58px; align-self: stretch; flex-direction: column; justify-content: center; gap: 0; padding: 3px 2px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .live-actions > button.profile-action-icon-control:disabled { cursor: default; }
      .profile-action-icon-control .profile-action-main { flex-direction: column; gap: 2px; overflow: visible; }
      .profile-action-icon-control .profile-action-main > span { overflow: visible; color: #ded8e7; font-size: clamp(12px, 3.35vw, 13px); font-weight: 700; line-height: 1.05; text-overflow: clip; }
      .profile-action-icon-control .profile-action-icon-frame { width: 27px; height: 27px; flex-basis: 27px; }
      .profile-action-icon-control .profile-action-preview-icon { width: 27px; height: 27px; padding: 0; border: 0; border-radius: 0; color: #d9d2e2; background: transparent; box-shadow: none; transition: color .16s ease, transform .16s ease; }
      .profile-action-icon-control .profile-action-preview-icon-personPlus { --profile-icon-offset-x: .5px; --profile-icon-offset-y: -.5px; }
      .profile-action-icon-control .profile-action-preview-icon-bell { --profile-icon-offset-y: -1px; }
      .profile-action-icon-control .profile-action-preview-icon-clock { --profile-icon-offset-x: -.5px; }
      .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="personPlus"] .profile-action-preview-icon { width: 28px; height: 28px; }
      .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="bell"] .profile-action-preview-icon { width: 26px; height: 26px; }
      .profile-action-icon-control .profile-action-icon-frame[data-profile-action-icon="clock"] .profile-action-preview-icon { width: 27px; height: 27px; }
      .profile-action-icon-control:is(:hover, :focus-visible):not(:disabled) .profile-action-preview-icon { color: #fff; transform: translate(var(--profile-icon-offset-x), calc(var(--profile-icon-offset-y) - 1px)) scale(1.02); }
      .profile-action-icon-control.profile-action-going:not(.profile-action-unavailable) .profile-action-preview-icon { color: #a78bfa; background: transparent; box-shadow: none; }
      .profile-action-icon-control:is(.is-selected, .is-going) .profile-action-preview-icon { color: #7cf0b4; background: transparent; box-shadow: none; }
      .live-actions > button.profile-action-icon-control.profile-action-unavailable:disabled { color: #766e7f; background: transparent; opacity: 1; }
      .profile-action-icon-control.profile-action-unavailable .profile-action-preview-icon { border: 0; color: #756d7d; background: transparent; box-shadow: none; }
      .profile-action-icon-control .profile-action-requirement { max-width: 100%; overflow: hidden; color: #8e8498; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }
      .profile-action-share-slot { min-width: 0; grid-column: auto; }
      .profile-action-share-slot .profile-share { display: block; min-height: 58px; }
      .profile-action-share-slot .profile-share button { gap: 6px; }
      .profile-action-share-slot .profile-share svg { fill: none; stroke: currentColor; stroke-width: 1.9; }
      .profile-action-share-slot .profile-share > span { display: block; color: #9fefff; font-size: 9px; text-align: center; }
      .live-actions > button:not(.profile-action-icon-control):not(.profile-report-action), .profile-action-share-slot .profile-share button.profile-action-preview-share { display: grid; grid-template-rows: 18px 9px; align-content: center; justify-items: center; row-gap: 1px; column-gap: 0; }
      .live-actions > button:not(.profile-action-icon-control):not(.profile-report-action) .profile-action-main, .profile-action-share-slot .profile-share button .profile-action-main { grid-row: 1; }
      .live-actions > button:not(.profile-action-icon-control):not(.profile-report-action) .profile-action-requirement { grid-row: 2; }
      .profile-directions-button { width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 8px; border: 1px solid rgba(226,232,240,.18); border-radius: 11px; color: #fff; background: linear-gradient(180deg, rgba(255,255,255,.065), transparent 52%), rgba(12,13,16,.86); cursor: pointer; font-size: 10px; font-weight: 900; text-align: center; text-decoration: none; }
      .profile-directions-button[aria-disabled="true"] { cursor: default; opacity: 1; }
      .profile-directions-button svg { width: 16px; height: 16px; flex: 0 0 16px; fill: none; stroke: rgba(226,232,240,.82); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .profile-directions-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-report-action { grid-column: 1 / -1; width: 28px !important; min-width: 28px !important; height: 28px !important; min-height: 28px !important; display: grid !important; place-items: center !important; justify-self: end; margin: 0; padding: 0 !important; border: 1px solid rgba(180,169,196,.2) !important; border-radius: 50% !important; color: #8d8497 !important; background: rgba(255,255,255,.035) !important; box-shadow: none !important; line-height: 1; opacity: .82; }
      .profile-report-action svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      .profile-report-action:hover, .profile-report-action:focus-visible { border-color: rgba(196,167,255,.42) !important; color: #d4ccd9 !important; outline: none; }
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
      .profile-action-overflow { position: relative; grid-column: 1 / -1; min-width: 0; justify-self: end; }
      .profile-action-overflow-toggle { min-width: 82px; min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 5px 10px; border: 1px solid rgba(148,229,255,.14); border-radius: 999px; color: #bfb5cc; background: rgba(255,255,255,.025); cursor: pointer; font-size: 10px; font-weight: 900; }
      .live-actions.is-no-shift .profile-action-overflow { grid-column: auto; width: 100%; justify-self: stretch; }
      .live-actions.is-no-shift .profile-action-overflow-toggle { width: 100%; min-height: 44px; border-radius: 11px; }
      .profile-action-overflow-toggle > span:first-child { color: #9fefff; font-size: 15px; letter-spacing: .08em; line-height: 1; }
      .profile-action-overflow-menu { position: absolute; z-index: 30; right: 0; top: calc(100% + 7px); width: min(220px, 74vw); display: grid; gap: 6px; padding: 8px; border: 1px solid rgba(126,234,255,.28); border-radius: 13px; background: rgba(10,8,16,.98); box-shadow: 0 18px 48px rgba(0,0,0,.56), 0 0 20px rgba(34,199,255,.08); }
      .profile-action-overflow-menu button { min-height: 44px; padding: 0 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; color: #d8d0e4; background: rgba(255,255,255,.035); font-size: 12px; font-weight: 850; text-align: left; cursor: pointer; }
      .profile-action-overflow-menu button:disabled { opacity: .6; cursor: wait; }
      .profile-action-status { grid-column: 1 / -1; color: #94e5ff; font-size: 12px; font-weight: 850; }
      .profile-working-card { display: block; margin-top: 8px; padding: 6px; border: 1px solid rgba(126,234,255,.24); border-radius: 14px; background: rgba(12,14,20,.86); box-shadow: 0 12px 30px rgba(0,0,0,.26); }
      .profile-working-head { display: block; }
      .profile-working-destination { min-height: 44px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 3px 7px; border-radius: 10px; color: inherit; text-decoration: none; }
      .profile-working-copy { min-width: 0; display: grid; gap: 1px; }
      .profile-working-copy small { color: #8f849c; font-size: 8px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
      .profile-working-copy strong { overflow: hidden; color: #fff; font-size: 15px; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
      .profile-working-copy em { overflow: hidden; color: #9c91aa; font-size: 9px; font-style: normal; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
      .profile-working-cue { color: #7eeaff; font-size: 26px; line-height: 1; }
      .profile-live-state, .eyebrow { width: fit-content; color: #94e5ff; font-size: 10px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .profile-live-state { padding: 5px 8px; border: 1px solid rgba(77,236,157,.42); border-radius: 999px; color: #b7ffd8; background: rgba(77,236,157,.08); font-size: 9px; letter-spacing: .08em; white-space: nowrap; }
      h2 { margin: 0; font-size: clamp(22px, 5vw, 32px); line-height: 1.05; }
      p { margin: 0; color: #cfc5de; font-size: 13px; line-height: 1.45; }
      .profile-active-deal { display: grid; justify-items: stretch; margin-top: 2px; }
      .profile-active-deal.has-club-deal { padding: 7px; border: 1px solid rgba(77,236,157,.5); border-radius: 15px; background: radial-gradient(circle at 88% 8%, rgba(77,236,157,.12), transparent 14rem), rgba(5,18,14,.9); box-shadow: 0 12px 34px rgba(0,0,0,.3), 0 0 24px rgba(77,236,157,.11); }
      .profile-active-deal.is-inactive { padding: 5px; border: 1px solid rgba(255,255,255,.09); border-radius: 13px; background: rgba(255,255,255,.025); box-shadow: none; }
      .profile-active-deal.is-inactive::before, .profile-active-deal.is-inactive::after { content: none; display: none; }
      .profile-club-deal-placeholder { min-height: 48px; display: grid; grid-template-columns: minmax(0,1fr) 76px; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(6,7,10,.68); }
      .profile-club-deal-placeholder > span { min-width: 0; display: grid; gap: 3px; }
      .profile-club-deal-placeholder small { color: #8f849c; font-size: 9px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
      .profile-club-deal-placeholder strong { overflow: hidden; color: #d9d3e0; font-size: 14px; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .profile-club-deal-placeholder em { overflow: hidden; color: #857b8f; font-size: 9px; font-style: normal; font-weight: 750; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
      .profile-club-deal-placeholder button { width: 76px; min-width: 76px; min-height: 38px; padding: 0 8px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; color: #756d7d; background: rgba(255,255,255,.025); font: inherit; font-size: 10px; font-weight: 900; }
      .club-deal-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 16px; border: 1px solid rgba(126,234,255,.22); border-radius: 14px; background: rgba(0,0,0,.24); }
      .club-deal-copy { min-width: 0; display: grid; gap: 7px; }
      .club-deal-copy h2 { font-size: 20px; }
      .club-deal-copy p, .club-deal-copy small { color: #ded6e8; font-size: 11px; font-weight: 750; line-height: 1.4; }
      .club-deal-action { display: grid; justify-items: end; gap: 8px; }
      .club-deal-action > button, .venue-qr-launcher { min-height: 44px; padding: 0 15px; border: 1px solid rgba(126,234,255,.4); border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; cursor: pointer; }
      .profile-active-deal .club-deal-launcher { width: 100%; border-color: rgba(77,236,157,.58); background: linear-gradient(135deg, rgba(7,78,65,.62), rgba(7,56,36,.7)); box-shadow: 0 0 18px rgba(77,236,157,.1); }
      .profile-active-deal .club-deal-launcher-copy { gap: 2px; }
      .profile-active-deal .club-deal-launcher-copy > strong { font-size: 15px; }
      .profile-active-deal .club-deal-launcher-context { overflow: hidden; color: rgba(221,255,238,.72); font-size: 9px; font-style: normal; font-weight: 750; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
      .profile-active-deal .club-deal-launcher-action { min-height: 32px; border: 1px solid rgba(77,236,157,.38); color: #eafff4; background: rgba(77,236,157,.09); font-size: 10px; }
      .deal-qr-frame { display: grid; justify-items: center; gap: 6px; }
      .deal-qr-frame img { width: 116px; aspect-ratio: 1; border-radius: 10px; background: #fff; }
      .deal-qr-frame span, .club-deal-action em { color: #9fefff; font-size: 10px; font-style: normal; }
      .venue-qr-launcher { width: 100%; display: flex; align-items: center; justify-content: space-between; }
      .venue-qr-launcher span { color: #d8f7ff; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; }
      .profile-deal-availability { width: min(100%, 760px); margin: 12px auto 0; border: 0; background: transparent; box-shadow: none; }
      .venue-qr-unavailable { width: 100%; min-height: 140px; display: grid; grid-template-columns: minmax(0, 1fr) 128px; align-items: center; justify-self: stretch; gap: 14px; padding: 14px 15px; border: 1px solid rgba(148,163,184,.2); border-radius: 18px; color: rgba(203,196,214,.76); background: rgba(17,17,24,.82); box-shadow: none; text-align: left; }
      .profile-deal-availability .venue-qr-unavailable { border-color: rgba(148,163,184,.13); background: rgba(17,17,24,.82); }
      .profile-deal-availability::before, .profile-deal-availability::after, .venue-qr-unavailable::before, .venue-qr-unavailable::after { content: none !important; display: none !important; background: none !important; box-shadow: none !important; }
      .venue-qr-placeholder-icon { width: 128px; min-width: 128px; min-height: 112px; display: grid; grid-template-rows: 42px auto; place-items: center; align-content: center; gap: 8px; padding: 12px 10px; border: 1px solid rgba(148,163,184,.18); border-radius: 14px; color: rgba(203,196,214,.58); background: rgba(255,255,255,.035); box-shadow: inset 0 1px 0 rgba(255,255,255,.03); opacity: 1; }
      .venue-qr-placeholder-icon > svg { width: 42px; height: 42px; }
      .venue-qr-placeholder-icon .qr-finder { fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: miter; }
      .venue-qr-placeholder-icon .qr-module { fill: currentColor; stroke: none; }
      .venue-qr-unavailable-copy { min-width: 0; display: grid; justify-items: start; gap: 7px; }
      .venue-qr-unavailable-label { color: rgba(203,196,214,.76); font-size: clamp(18px, 5vw, 23px); font-weight: 950; letter-spacing: -.015em; line-height: 1.05; }
      .venue-qr-unavailable-copy small { color: rgba(203,196,214,.7); font-size: 11px; font-weight: 800; line-height: 1.3; }
      .venue-qr-placeholder-copy { display: grid; gap: 2px; text-align: center; }
      .venue-qr-placeholder-copy strong { color: rgba(203,196,214,.7); font-size: 12px; font-weight: 950; line-height: 1.08; }
      .venue-qr-placeholder-copy small { color: rgba(203,196,214,.64); font-size: 9px; font-weight: 850; line-height: 1.12; }
      @media (max-width: 340px) { .venue-qr-unavailable { grid-template-columns: minmax(0, 1fr) 112px; } .venue-qr-placeholder-icon { width: 112px; min-width: 112px; } }
      .profile-schedule-section { margin-top: 24px; }
      .profile-media-section { position: relative; isolation: isolate; display: grid; gap: 3px; margin-top: 12px; padding-bottom: 0; overflow: clip; border-radius: 18px; background: rgba(5,5,8,.78); box-shadow: 0 12px 28px rgba(0,0,0,.22); }
      .profile-media-section::after { content: ""; position: absolute; z-index: 40; inset: 0; border: 1px solid rgba(180,169,196,.38); border-radius: inherit; pointer-events: none; }
      .profile-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .profile-section-heading > div { display: grid; gap: 5px; }
      .profile-section-heading > span { color: #9487a5; font-size: 11px; font-weight: 850; }
      .profile-media-tabs { position: sticky; z-index: 20; top: 0; width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-self: stretch; gap: 0; padding: 0; border: 0; border-bottom: 1px solid rgba(255,255,255,.1); border-radius: 0; background: rgba(5,5,8,.94); box-shadow: 0 8px 18px rgba(0,0,0,.18); backdrop-filter: blur(16px); }
      body.dancr-button-system .public-profile-shell .profile-media-tabs button { position: relative; min-width: 0; min-height: 52px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border: 0 !important; border-radius: 0 !important; color: #968b9f; background: transparent !important; box-shadow: none !important; cursor: pointer; }
      body.dancr-button-system .public-profile-shell .profile-media-tabs button::before { content: none; }
      .profile-media-tab-icon { width: 20px; height: 20px; display: block; flex: 0 0 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .profile-media-tab-play { fill: currentColor; stroke: none; }
      .profile-media-tab-label { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
      .profile-media-tab-count { min-width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #cfc7d8; background: rgba(255,255,255,.035); font-size: 9px; font-weight: 950; line-height: 1; }
      body.dancr-button-system .public-profile-shell .profile-media-tabs button.active { color: #fff !important; background: rgba(139,92,246,.055) !important; box-shadow: inset 0 -2px #8b5cf6 !important; text-shadow: none; }
      .profile-media-tabs button:disabled { opacity: .42; cursor: default; }
      .profile-media-grid { min-height: 108px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
      .profile-media-grid-item { position: relative; width: 100%; min-width: 0; aspect-ratio: 9 / 16; display: block; padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.08); border-radius: 3px; color: #fff; background: #0b0b10; box-shadow: none; cursor: pointer; }
      .profile-media-grid-item:is(.is-photo,.is-video)::before { position: absolute; z-index: 0; inset: 0; content: ""; background: radial-gradient(circle at 68% 20%, rgba(126,234,255,.12), transparent 34%), radial-gradient(circle at 20% 82%, rgba(139,92,246,.2), transparent 42%), linear-gradient(145deg,#111118,#07070b); }
      .profile-media-grid-item img, .profile-media-grid-item video { position: relative; z-index: 1; width: 100%; height: 100%; display: block; object-fit: cover; background: transparent; pointer-events: none; }
      .profile-media-grid-item img { filter: brightness(1.14) contrast(1.03); opacity: 0; mix-blend-mode: normal; }
      .profile-media-grid-item img[data-image-state="ready"] { opacity: 1; }
      .profile-media-grid-item img[data-image-state="error"] { visibility: hidden; }
      .profile-media-poster-placeholder { width: 100%; height: 100%; display: block; background: radial-gradient(circle at 50% 32%, rgba(126,234,255,.18), transparent 28%), linear-gradient(145deg, rgba(109,40,217,.28), rgba(5,5,9,.96)); }
      .profile-media-grid-item:hover { border-color: rgba(126,234,255,.42); }
      .profile-media-grid-item:focus-visible { z-index: 1; outline: 2px solid #7eeaff; outline-offset: 2px; }
      .profile-media-play { position: absolute; z-index: 2; top: 50%; left: 50%; width: 34px; aspect-ratio: 1; box-sizing: border-box; border: 1px solid rgba(255,255,255,.38); border-radius: 50%; background: rgba(5,5,9,.62); box-shadow: 0 6px 18px rgba(0,0,0,.38); transform: translate(-50%, -50%); pointer-events: none; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
      .profile-media-play::after { content: ""; position: absolute; top: 50%; left: 54%; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 9px solid #fff; transform: translate(-50%, -50%); }
      .profile-media-grid-sentinel { position: relative; grid-column: 1 / -1; height: 28px; pointer-events: none; }
      .profile-media-grid-sentinel::after { position: absolute; top: 5px; left: 50%; width: 14px; height: 14px; content: ""; border: 2px solid rgba(126,234,255,.18); border-top-color: #7eeaff; border-radius: 50%; animation: profile-media-loading 700ms linear infinite; transform: translateX(-50%); }
      .profile-media-grid-status { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .profile-media-empty { grid-column: 1 / -1; min-height: 108px; display: grid; place-items: center; color: #8f849c; text-align: center; }
      .profile-media-viewer { position: fixed; z-index: 1600; inset: 0; width: 100vw; height: 100vh; height: 100dvh; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; color: #fff; background: rgba(0,0,0,.98); overscroll-behavior: none; touch-action: none; }
      .profile-media-viewer:fullscreen, .profile-media-viewer:-webkit-full-screen { width: 100vw; height: 100vh; height: 100dvh; border: 0; background: #000; }
      .profile-media-viewer-close { position: fixed; z-index: 3; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); width: 50px; height: 50px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: rgba(10,10,14,.78); font-size: 30px; cursor: pointer; backdrop-filter: blur(12px); }
      .profile-media-viewer-stage { position: relative; width: 100%; height: 100%; min-height: 0; display: block; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; scroll-snap-type: y mandatory; scroll-behavior: smooth; scrollbar-width: none; touch-action: pan-y; }
      .profile-media-viewer-stage::-webkit-scrollbar { display: none; }
      .profile-media-viewer-slide { position: relative; width: 100%; height: 100%; min-height: 100%; max-height: 100%; display: grid; place-items: center; overflow: hidden; background: #000; scroll-snap-align: start; scroll-snap-stop: always; }
      .profile-media-viewer-slide::before { position: absolute; z-index: 0; inset: 0; content: ""; background: radial-gradient(circle at 50% 32%, rgba(126,234,255,.1), transparent 26%), linear-gradient(145deg, rgba(109,40,217,.18), #020204 68%); }
      .profile-media-viewer-slide > img, .profile-media-viewer-slide > video { position: relative; z-index: 1; width: 100%; height: 100%; max-height: 100%; display: block; object-fit: contain; background: transparent; user-select: none; }
      .profile-media-playback-feedback { position: absolute; z-index: 3; top: 50%; left: 50%; width: 64px; height: 64px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.28); border-radius: 50%; color: #fff; background: rgba(0,0,0,.58); box-shadow: 0 10px 30px rgba(0,0,0,.42); pointer-events: none; transform: translate(-50%, -50%); animation: profile-media-playback-feedback 850ms ease both; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
      .profile-media-playback-feedback svg { width: 29px; height: 29px; fill: currentColor; stroke: none; }
      .profile-media-viewer-slide > img { filter: brightness(1.14) contrast(1.03); opacity: 0; mix-blend-mode: normal; }
      .profile-media-viewer-slide > img[data-image-state="ready"] { opacity: 1; }
      .profile-media-viewer-slide > img[data-image-state="error"] { visibility: hidden; }
      @media (prefers-reduced-motion: no-preference) { .profile-media-grid-item img, .profile-media-viewer-slide > img { transition: opacity 160ms ease-out; } }
      .profile-media-viewer-previous, .profile-media-viewer-next { position: absolute; top: 50%; width: 46px; height: 58px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(5,5,8,.58); font-size: 34px; transform: translateY(-50%); cursor: pointer; backdrop-filter: blur(8px); }
      .profile-media-viewer-previous { left: 12px; }
      .profile-media-viewer-next { right: 12px; }
      .profile-media-viewer-previous:disabled, .profile-media-viewer-next:disabled { opacity: 0; pointer-events: none; }
      .profile-media-viewer-footer { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px max(18px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); border-top: 1px solid rgba(255,255,255,.1); background: #07070a; }
      .profile-media-viewer-copy { min-width: 0; display: grid; gap: 3px; }
      .profile-media-viewer-copy span { color: #aaa0b8; font-size: 12px; }
      .profile-media-viewer-actions { min-width: 92px; display: grid; justify-items: end; gap: 8px; }
      .profile-media-viewer-share, .profile-media-viewer-report { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 15px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; color: #fff; background: rgba(255,255,255,.08); font-size: 12px; font-weight: 900; cursor: pointer; backdrop-filter: blur(10px); }
      .profile-media-viewer-like { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 15px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; color: #fff; background: rgba(255,255,255,.08); font-size: 12px; font-weight: 900; cursor: pointer; backdrop-filter: blur(10px); }
      .profile-media-viewer-share svg, .profile-media-viewer-report svg, .profile-media-viewer-like svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.9; }
      .profile-media-viewer-like.is-liked { color: #fff; }
      .profile-media-viewer-like.is-liked svg { color: #ff304f; fill: currentColor; }
      .profile-media-viewer-like:disabled { opacity: .64; cursor: wait; }
      .profile-media-viewer-share-status { min-height: 14px; color: #a7f3d0; font-size: 10px; font-weight: 800; text-align: right; }
      .profile-media-viewer-hint { color: #aaa0b8; font-size: 11px; font-weight: 800; }
      .profile-media-viewer { display: block; }
      .profile-media-viewer .profile-media-viewer-stage { width: 100%; height: 100%; }
      .profile-media-viewer.is-photo .profile-media-viewer-slide > img { object-fit: cover; }
      .profile-media-viewer.is-video .profile-media-viewer-slide > video { object-fit: cover; }
      .profile-media-viewer .profile-media-viewer-previous,
      .profile-media-viewer .profile-media-viewer-next { position: fixed; z-index: 2; left: auto; right: max(12px, env(safe-area-inset-right)); width: 48px; height: 48px; border-color: rgba(255,255,255,.2); background: rgba(8,8,12,.68); font-size: 22px; transform: none; }
      .profile-media-viewer .profile-media-viewer-previous { top: 34%; }
      .profile-media-viewer .profile-media-viewer-next { top: calc(34% + 58px); }
      .profile-media-viewer .profile-media-viewer-footer { position: absolute; z-index: 2; inset: 0; min-height: 0; display: block; padding: 0; border: 0; background: linear-gradient(0deg, rgba(0,0,0,.82) 0, rgba(0,0,0,.34) 14%, transparent 38%); pointer-events: none; }
      .profile-media-viewer.is-photo .profile-media-viewer-footer { background: transparent; }
      .profile-media-viewer .profile-media-viewer-copy { position: absolute; right: 82px; bottom: max(22px, calc(env(safe-area-inset-bottom) + 14px)); left: max(18px, env(safe-area-inset-left)); gap: 4px; text-shadow: 0 2px 8px rgba(0,0,0,.9); }
      .profile-media-viewer .profile-media-viewer-actions { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: max(22px, calc(env(safe-area-inset-bottom) + 14px)); min-width: 0; pointer-events: auto; }
      .profile-media-viewer .profile-media-viewer-share, .profile-media-viewer .profile-media-viewer-report { width: 52px; min-width: 52px; max-width: 52px; height: 52px; min-height: 52px; max-height: 52px; display: grid; place-items: center; gap: 0; padding: 6px 0 4px; border-radius: 50% !important; font-size: 9px; line-height: 1; }
      .profile-media-viewer .profile-media-viewer-like { width: 52px; min-width: 52px; max-width: 52px; height: 52px; min-height: 52px; max-height: 52px; display: grid; place-items: center; gap: 0; padding: 6px 0 4px; border-radius: 50% !important; font-size: 9px; line-height: 1; }
      .profile-media-viewer .profile-media-viewer-share svg, .profile-media-viewer .profile-media-viewer-report svg, .profile-media-viewer .profile-media-viewer-like svg { width: 21px; height: 21px; }
      .profile-media-viewer .profile-media-viewer-share-status { position: absolute; right: 56px; bottom: 4px; width: max-content; max-width: 180px; text-shadow: 0 1px 5px #000; }
      .profile-media-viewer-preload { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
      .profile-media-viewer-preload img, .profile-media-viewer-preload video { width: 1px; height: 1px; }
      @keyframes profile-media-loading { to { transform: translateX(-50%) rotate(360deg); } }
      @keyframes profile-media-playback-feedback { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.82); } 18%, 70% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(.94); } }
      .profile-schedule-section { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(139,92,246,.27); border-radius: 18px; background: rgba(10,10,16,.84); }
      .profile-tonight-card { position: relative; isolation: isolate; margin-top: 8px; overflow: hidden; border: 1px solid transparent; border-radius: 15px; background: linear-gradient(145deg, rgba(13,11,21,.94), rgba(6,7,11,.98)); box-shadow: 0 12px 32px rgba(0,0,0,.26); }
      .profile-tonight-card::before { position: absolute; z-index: 5; inset: 0; content: ""; pointer-events: none; border: 2px solid rgba(255,255,255,.13); border-radius: inherit; }
      .profile-tonight-card.is-now { background: radial-gradient(circle at 94% 0%, rgba(77,236,157,.045), transparent 13rem), rgba(7,14,13,.94); }
      .profile-tonight-card.is-now::before, .profile-tonight-card.has-club-deal::before { border-color: rgba(77,236,157,.38); }
      .profile-tonight-card.is-upcoming { background: radial-gradient(circle at 94% 0%, rgba(34,211,238,.045), transparent 13rem), rgba(7,12,16,.94); }
      .profile-tonight-card.is-upcoming::before { border-color: rgba(34,211,238,.55); }
      .profile-tonight-card.is-no-schedule { background: radial-gradient(circle at 94% 0%, rgba(255,255,255,.035), transparent 13rem), rgba(9,9,13,.94); }
      .profile-tonight-card.has-club-deal { border-color: transparent; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      .profile-tonight-card > .profile-shift-card { width: 100%; min-height: 52px; margin: 0; padding: 4px 8px !important; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .profile-tonight-card > .profile-schedule-section { padding: 14px; }
      .profile-tonight-card > .profile-schedule-empty { display: grid; grid-template-columns: max-content minmax(0,1fr); align-items: center; gap: 6px; }
      .profile-empty-state { color: #a9a3af; font-size: 11px; font-weight: 950; letter-spacing: .075em; line-height: 1.05; text-transform: uppercase; white-space: nowrap; }
      .profile-empty-copy { min-width: 0; display: grid; gap: 2px; }
      .profile-empty-copy strong { overflow: hidden; color: #f5f2f7; font-size: 14px; font-weight: 950; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
      .profile-empty-copy em { overflow: hidden; color: #8e8795; font-size: 10px; font-style: normal; font-weight: 750; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
      .profile-tonight-travel-actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 5px 10px 8px; border-top: 1px solid rgba(255,255,255,.06); }
      .profile-tonight-travel-actions:is(.is-working-now, .is-upcoming, .is-no-schedule) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .profile-tonight-travel-actions.is-upcoming.has-venue-deal-link { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .profile-tonight-travel-actions > :is(a, button) { width: 100% !important; height: 44px !important; min-height: 44px !important; max-height: 44px !important; padding-inline: 10px !important; border: 1px solid rgba(255,255,255,.14) !important; border-radius: 10px !important; color: rgba(248,250,252,.94) !important; background: rgba(255,255,255,.055) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.05) !important; font-size: 11px !important; opacity: 1 !important; }
      .profile-tonight-travel-actions > .profile-directions-button { border-color: rgba(226,232,240,.18) !important; background: linear-gradient(180deg, rgba(255,255,255,.065), transparent 52%), rgba(12,13,16,.86) !important; }
      .profile-tonight-travel-actions > .profile-upcoming-venue-deal { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-color: rgba(34,211,238,.38) !important; color: #7eeaff !important; background: rgba(34,211,238,.10) !important; font-weight: 900; text-decoration: none; }
      .profile-tonight-travel-actions > :is(a, button) :is(svg, span) { opacity: 1 !important; }
      .profile-tonight-travel-actions > .profile-upcoming-venue-deal svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .profile-tonight-travel-actions > .profile-travel-placeholder { display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: rgba(169,163,175,.58) !important; border-color: rgba(255,255,255,.08) !important; background: rgba(255,255,255,.025) !important; box-shadow: none !important; font: inherit; font-size: 11px; font-weight: 900; cursor: default; }
      .profile-tonight-travel-actions > .profile-travel-placeholder svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .profile-tonight-deal { min-height: 70px; display: grid; align-items: stretch; padding: 5px; border-top: 1px solid rgba(255,255,255,.08); }
      .profile-tonight-card.has-club-deal .profile-tonight-deal { border-top-color: rgba(77,236,157,.18); }
      .profile-tonight-card.is-upcoming .profile-tonight-deal { border-top-color: rgba(126,234,255,.16); }
      .profile-tonight-card.is-no-schedule .profile-tonight-deal { border-top-color: rgba(255,255,255,.07); }
      .profile-tonight-deal .profile-active-deal { width: 100%; min-height: 60px; display: grid; align-items: stretch; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .profile-tonight-deal .profile-club-deal-placeholder { width: 100%; min-height: 60px; border: 0; background: transparent; box-shadow: none; }
      .profile-tonight-deal .club-deal-launcher { width: 100%; min-height: 60px; }
      .profile-working-card, .profile-upcoming-card { display: grid; padding: 4px 8px !important; }
      .profile-upcoming-list { display: grid; }
      .profile-working-destination, .profile-upcoming-destination { min-width: 0; display: grid; grid-template-columns: max-content minmax(0,1fr) 16px; align-items: center; gap: 6px; min-height: 44px; padding: 3px 2px; color: #fff; text-decoration: none; }
      .profile-upcoming-destination + .profile-upcoming-destination { border-top: 1px solid rgba(126,234,255,.12); }
      .profile-upcoming-state { color: #7eeaff; font-size: 11px; font-weight: 950; letter-spacing: .03em; line-height: 1.05; text-transform: uppercase; white-space: nowrap; }
      .profile-upcoming-copy { min-width: 0; }
      .profile-upcoming-copy strong { display: block; overflow: hidden; color: #fff; font-size: 14px; font-weight: 950; text-overflow: ellipsis; white-space: nowrap; }
      .profile-upcoming-cue { color: #7eeaff; font-size: 23px; line-height: 1; }
      .profile-upcoming-destination .profile-venue-pin { color: #22d3ee; stroke: currentColor; }
      .shift-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
      .shift-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 14px; border: 1px solid rgba(255,255,255,.085); border-radius: 14px; color: #f7f2ff; background: rgba(255,255,255,.035); text-decoration: none; }
      .shift-date { grid-column: 1 / -1; color: #94e5ff; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .shift-row strong { min-width: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .shift-time { color: #b9accd; font-size: 11px; }
      .shift-row em { grid-column: 2; grid-row: 2 / span 2; align-self: center; padding: 6px 9px; border: 1px solid rgba(148,229,255,.22); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.08); font-size: 9px; font-style: normal; font-weight: 950; text-transform: uppercase; }
      .profile-account-gate, .profile-report-gate, .profile-schedule-gate { position: fixed; inset: 0; z-index: 1700; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.8); backdrop-filter: blur(11px); }
      .profile-account-gate-dialog, .profile-report-dialog, .profile-schedule-dialog { position: relative; width: min(430px, 100%); max-height: calc(100dvh - 24px); display: grid; gap: 14px; padding: 24px; overflow-y: auto; border: 1px solid rgba(53,216,255,.42); border-radius: 16px; background: linear-gradient(145deg, #0b0b13, #060609); box-shadow: 0 28px 90px rgba(0,0,0,.72); }
      .profile-account-gate-dialog { gap: 10px; padding: 19px; }
      .profile-account-gate-dialog > span, .profile-report-dialog > span, .profile-schedule-dialog > span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .profile-account-gate-dialog h2, .profile-report-dialog h2 { padding-right: 40px; }
      .profile-account-gate-dialog > div { display: grid; gap: 4px; margin-top: 2px; }
      .profile-account-gate-dialog a, .profile-report-dialog form > button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; text-decoration: none; }
      .profile-account-gate-dialog a.secondary { min-height: 44px; padding: 0 8px; border: 0; border-radius: 10px; color: #a99eb7; background: transparent; font-size: 14px; font-weight: 750; }
      .profile-account-gate-dialog a.secondary:hover, .profile-account-gate-dialog a.secondary:focus-visible { color: #fff; outline: 2px solid rgba(126,234,255,.46); outline-offset: -4px; text-decoration: underline; text-underline-offset: 3px; }
      .profile-account-gate-close, .profile-report-close, .profile-schedule-dialog-close { position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(53,216,255,.42); border-radius: 50%; color: #fff; background: #08080d; font-size: 26px; cursor: pointer; }
      .profile-schedule-dialog-list { display: grid; gap: 8px; }
      .profile-schedule-dialog-list > div { display: grid; gap: 3px; padding: 11px 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 11px; background: rgba(255,255,255,.035); }
      .profile-schedule-dialog-list > div.is-active { border-color: rgba(77,236,157,.42); background: rgba(77,236,157,.08); }
      .profile-schedule-dialog-list small { color: #a99eb7; font-size: 10px; }
      .profile-report-dialog form, .profile-report-dialog label { display: grid; gap: 8px; }
      .profile-report-dialog form { gap: 13px; }
      .profile-report-dialog label { color: #e9e2f4; font-size: 13px; font-weight: 900; }
      .profile-report-dialog select, .profile-report-dialog textarea { width: 100%; padding: 11px; border: 1px solid rgba(139,92,246,.35); border-radius: 11px; color: #fff; background: rgba(255,255,255,.055); }
      .profile-report-dialog option { color: #111; }
      .profile-report-error { margin: 10px 2px 0; color: #ffb4c8; font-size: 11px; font-weight: 800; }
      .public-report-reason-gate { padding: 17px; background: rgba(0,0,0,.2); backdrop-filter: none; }
      .public-report-reason-dialog { width: min(400px, 100%); gap: 0; padding: 16px; overflow: visible; border: 1px solid rgba(255,255,255,.14); border-radius: 21px; background: rgba(7,7,10,.96); box-shadow: 0 20px 54px rgba(0,0,0,.62); backdrop-filter: blur(18px) saturate(1.08); }
      .public-report-reason-header { min-height: 54px; display: flex; align-items: center; gap: 12px; padding: 0 0 10px 8px; }
      .public-report-reason-dialog .public-report-reason-header h2 { min-width: 0; flex: 1; margin: 0; padding: 0 !important; color: rgba(255,255,255,.78); font-size: 12px; font-weight: 950; letter-spacing: .08em; line-height: 1.15; text-transform: uppercase; }
      .public-report-reason-close { position: static; width: 52px; min-width: 52px; height: 52px; display: grid; place-items: center; align-self: flex-start; margin: 0; padding: 0; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; color: #aaa4af; background: rgba(30,31,38,.96); box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 8px 24px rgba(0,0,0,.35); cursor: pointer; }
      .public-report-reason-close svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .public-report-reason-close:hover, .public-report-reason-close:focus-visible { border-color: rgba(196,167,255,.5); color: #fff; outline: none; box-shadow: 0 0 0 3px rgba(124,58,237,.14), 0 8px 24px rgba(0,0,0,.35); }
      .public-report-reason-close:disabled { cursor: wait; opacity: .68; }
      .public-report-reason-options { display: grid; gap: 8px; }
      .public-report-reason-options button { min-height: 62px; padding: 0 16px; border: 1px solid rgba(255,255,255,.075); border-radius: 12px; color: #eee9f3; background: rgba(255,255,255,.012); font: inherit; font-size: 13px; font-weight: 850; text-align: left; cursor: pointer; }
      .public-report-reason-options button:hover, .public-report-reason-options button:focus-visible { border-color: rgba(255,92,128,.48); color: #fff; background: rgba(255,92,128,.1); outline: none; }
      .public-report-reason-options button:disabled { cursor: wait; opacity: .68; }
      @media (max-width: 600px) {
        .public-profile-shell { padding: 0 12px max(132px, calc(108px + env(safe-area-inset-bottom))); }
        body.dancr-button-system .public-profile-shell .profile-titlebar { grid-template-columns: minmax(108px, .92fr) minmax(0, 1.08fr) 44px !important; gap: 5px !important; min-height: 64px !important; padding: max(6px, env(safe-area-inset-top)) 0 6px !important; }
        .profile-titlebar-person { grid-template-columns: 46px minmax(0, 1fr); gap: 7px; }
        .profile-titlebar-avatar { width: 46px; height: 46px; }
        .profile-titlebar h1 { font-size: clamp(17px, 5vw, 22px); }
        body.dancr-button-system .public-profile-shell .profile-titlebar-identity { display: grid !important; align-items: center !important; gap: 2px !important; overflow: hidden !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-identity > div:first-child,
        body.dancr-button-system .public-profile-shell .profile-titlebar-context { max-width: 100%; min-width: 0; }
        body.dancr-button-system .public-profile-shell .profile-header-metrics > div { min-height: 42px; display: grid !important; grid-template-rows: 22px 14px !important; align-content: center !important; justify-items: center !important; gap: 1px !important; padding: 2px 1px !important; }
        .profile-titlebar-controls { grid-template-columns: 44px; }
        .public-profile-close { width: 44px; min-height: 44px; }
        .live-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .profile-action-share-slot .profile-share > span { position: absolute; width: 1px; height: 1px; overflow: hidden; }
        .profile-working-card { padding: 5px; }
        .club-deal-card { grid-template-columns: minmax(0, 1fr) 128px; gap: 14px; padding: 14px; }
        .club-deal-action { justify-items: stretch; }
        .deal-qr-frame { justify-items: center; }
        .deal-qr-frame img { width: 128px; }
        .profile-media-tabs { width: 100%; }
        body.dancr-button-system .public-profile-shell .profile-media-tabs button { padding-inline: 9px; }
        .profile-media-grid { gap: 3px; }
        .profile-media-viewer-previous, .profile-media-viewer-next { width: 40px; height: 50px; font-size: 30px; }
        .shift-list { grid-template-columns: 1fr; }
      }
      @media (max-width: 340px) {
        body.dancr-button-system .public-profile-shell .profile-titlebar { grid-template-columns: minmax(104px, .9fr) minmax(0, 1.1fr) 80px !important; gap: 5px !important; min-height: 62px !important; }
        .profile-titlebar-person { grid-template-columns: 42px minmax(0, 1fr); gap: 6px; }
        .profile-titlebar-avatar { width: 42px; height: 42px; }
        .profile-titlebar-identity > div:first-child { display: grid !important; grid-template-columns: minmax(0, 1fr) 18px; gap: 3px !important; }
        .public-profile-close { width: 44px; min-height: 44px; }
        .profile-header-metrics > div { padding-inline: 1px; }
        .profile-header-metrics dt { font-size: 8px; }
        .club-deal-card { grid-template-columns: 1fr; }
        .profile-media-tab-label { font-size: 11px; }
        .profile-media-viewer-hint { display: none; }
      }
      /* The close control occupies only the identity band, leaving the lower
         analytics row the full width beside a more prominent avatar. */
      @media (max-width: 600px) {
        body.dancr-button-system .public-profile-shell .profile-titlebar { grid-template-columns: 80px minmax(0, 1fr) !important; grid-template-rows: 46px 42px !important; align-items: stretch !important; column-gap: 0 !important; row-gap: 4px !important; min-height: 102px !important; padding: max(7px, env(safe-area-inset-top)) 0 7px !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-person { display: contents !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-avatar { grid-column: 1 !important; grid-row: 1 / 3 !important; width: 72px !important; height: 72px !important; align-self: start !important; justify-self: center !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-identity { grid-column: 2 !important; grid-row: 1 !important; align-content: start !important; padding-right: 48px !important; overflow: visible !important; }
        body.dancr-button-system .public-profile-shell .profile-header-metrics { grid-column: 2 !important; grid-row: 2 !important; width: 100% !important; align-self: stretch !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-controls { position: absolute !important; top: max(3px, env(safe-area-inset-top)) !important; right: 0 !important; width: 44px !important; }
        body.dancr-button-system .public-profile-shell .live-actions { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
      }
      @media (max-width: 340px) {
        body.dancr-button-system .public-profile-shell .profile-titlebar { grid-template-columns: 70px minmax(0, 1fr) !important; grid-template-rows: 44px 40px !important; min-height: 96px !important; column-gap: 0 !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-avatar { width: 64px !important; height: 64px !important; }
        body.dancr-button-system .public-profile-shell .profile-titlebar-identity { padding-right: 46px !important; }
        body.dancr-button-system .public-profile-shell .live-actions { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
      }
    `}</style>
  );
}
