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
  const [activeDeals, tvVideos, activeVenue] = await Promise.all([
    activeShift?.venueId
      ? getActiveClubDealsForVenue(client, activeShift.venueId)
      : Promise.resolve([]),
    getPublicMyDancrTvFeed(client, {
      city: profile.city,
      dancerId: profile.id,
      limit: MAX_DANCER_PROFILE_VIDEOS,
    }),
    activeShift?.venueSlug
      ? getVenueProfile(client, activeShift.venueSlug)
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
                  height={avatarPhotoHeight || undefined}
                  sizes="46px"
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

        {activeShift ? (
          <section
            className={`profile-working-card${activeDeal ? " has-club-deal" : ""}`}
            aria-labelledby="profile-working-title"
          >
            <div className="profile-working-head">
              <Link
                className="profile-working-destination"
                href={`/venues/${encodeURIComponent(activeShift.venueSlug)}`}
              >
                <span className="profile-live-state" id="profile-working-title">Working now</span>
                <span className="profile-working-copy">
                  <small>Club</small>
                  <strong>{activeShift.venueName}</strong>
                  <em>Venue-confirmed until {formatShiftTime(activeShift.locationVerificationExpiresAt || activeShift.endsAt, activeShift.timezone)}</em>
                </span>
                <span aria-hidden="true" className="profile-working-cue">›</span>
              </Link>
            </div>
          </section>
        ) : upcomingShifts.length ? (
          <section
            className="profile-schedule-section"
            aria-labelledby="profile-schedule-title"
          >
            <div className="profile-section-heading">
              <div>
                <span className="eyebrow">Schedule</span>
                <h2 id="profile-schedule-title">Upcoming dates</h2>
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
                    {formatShiftDate(shift.shiftDate || shift.startsAt, shift.timezone)}
                  </span>
                  <strong>{shift.venueName}</strong>
                  <span className="shift-time">
                    Upcoming · Venue and date posted
                  </span>
                  <em>Club</em>
                </Link>
              ))}
            </div>
          </section>
        ) : activeShift || !upcomingShifts.length ? (
          <section className="profile-schedule-empty" aria-label="Schedule status">
            <strong>No shift posted</strong>
            <span aria-hidden="true">·</span>
            <span>Follow {profile.stageName} for updates</span>
          </section>
        ) : null}

        <DancerProfileActions
          dancerId={profile.id}
          profileName={profile.stageName}
          rideControl={activeVenue ? (
            <UberRideButton
              dancerId={profile.id}
              source="dancer_profile"
              venue={{ ...activeVenue, isActive: true, isPublic: true }}
            />
          ) : null}
          shareControl={<ProfileShareButton stageName={profile.stageName} />}
          shifts={profile.upcomingShifts.map((shift) => ({
            id: shift.id,
            label: shortShiftLabel(shift.shiftDate || shift.startsAt, shift.timezone),
            isActive: isActiveNow(shift),
          }))}
        />

        {activeShift && activeDeal ? (
          <section
            className="profile-active-deal has-club-deal"
            aria-label="Active Club Deal for cashier NFC"
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
              presentation="launcher"
              ctaLabel={activeDeals.length > 1 ? `View all ${activeDeals.length}` : "Use at Club"}
              sectionId="club-deal"
            />
          </section>
        ) : activeShift || !upcomingShifts.length ? (
          <section
            className="profile-active-deal is-inactive"
            aria-label="Inactive Club Deal"
          >
            <div className="profile-club-deal-placeholder">
              <span>
                <small>Club Deal</small>
                <strong>
                  {activeShift ? "No active deal" : "No active club deal"}
                </strong>
                <em>
                  {activeShift
                    ? `${activeShift.venueName} has no live offer right now.`
                    : "Deals activate after a verified club check-in."}
                </em>
              </span>
              <button disabled type="button">Inactive</button>
            </div>
          </section>
        ) : null}

        {profile.socialLinks.length ? (
          <section className="profile-social-section" aria-label="External profiles">
            <SocialLinks dancerId={profile.id} links={profile.socialLinks} showHeading={false} />
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
      .profile-titlebar { position: relative; z-index: 1; max-width: 760px; min-height: 64px; display: flex; align-items: center; justify-content: flex-start; gap: 10px; margin: 0 auto; padding: max(8px, env(safe-area-inset-top)) 52px 8px 0; border-bottom: 0; background: radial-gradient(circle at 14% 0%, rgba(126,234,255,.055), transparent 11rem), linear-gradient(180deg, rgba(5,5,8,.98), rgba(5,5,8,.92)); box-shadow: 0 8px 24px rgba(0,0,0,.2); backdrop-filter: blur(22px); }
      .profile-titlebar-avatar { width: 42px; height: 42px; position: relative; display: grid; flex: 0 0 42px; place-items: center; overflow: hidden; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgba(124,58,237,.72), rgba(34,199,255,.35)); box-shadow: 0 10px 26px rgba(0,0,0,.36), 0 0 18px rgba(124,58,237,.15); font-size: 13px; font-weight: 950; }
      .profile-titlebar-avatar.has-photo { filter: none; opacity: 1; mix-blend-mode: normal; }
      .profile-titlebar-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; filter: brightness(1.14) contrast(1.03); }
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
      .public-profile-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: 0; width: 40px; min-height: 40px; display: inline-grid; flex: 0 0 40px; place-items: center; padding: 0; border: 1px solid rgba(180,169,196,.2); border-radius: 50%; color: #fff; background: rgba(24,24,30,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 10px 24px rgba(0,0,0,.28); font-size: 26px; line-height: 1; cursor: pointer; }
      .public-profile-close:hover, .public-profile-close:focus-visible { border-color: #7eeaff; outline: none; box-shadow: 0 0 0 3px rgba(126,234,255,.13), 0 0 22px rgba(34,199,255,.18); }
      .profile-overview, .profile-social-section, .live-actions, .profile-working-card, .profile-active-deal, .profile-deal-availability, .profile-media-section, .profile-schedule-section, .profile-schedule-empty { width: min(100%, 760px); margin-inline: auto; }
      .profile-schedule-empty { min-width: 0; display: flex; align-items: center; gap: 6px; margin-top: 5px; padding: 8px 10px; overflow: hidden; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; color: #82798c; background: rgba(255,255,255,.025); font-size: 10px; line-height: 1.2; }
      .profile-schedule-empty strong { flex: 0 0 auto; color: #d9d3e0; font-size: 12px; white-space: nowrap; }
      .profile-schedule-empty > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-overview { display: block; margin-top: 0; padding: 10px 0 4px; border-top: 1px solid rgba(126,234,255,.08); }
      .profile-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; }
      .profile-metrics > div { min-width: 0; display: grid; gap: 4px; justify-items: center; padding: 8px 4px; }
      .profile-metrics dd { margin: 0; color: #eee9f5; font-size: clamp(18px, 3.5vw, 24px); font-weight: 950; line-height: 1; }
      .profile-metrics dt { color: #8f849c; font-size: clamp(9px, 2.1vw, 11px); font-weight: 850; text-align: center; }
      .profile-social-section { display: grid; margin-top: 6px; margin-bottom: 4px; padding: 6px 0 4px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
      .social-links-control { display: grid; justify-items: center; gap: 0; text-align: center; }
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
      .live-actions { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 9px 0 8px; }
      .live-actions.is-no-shift { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .live-actions > button, .profile-action-share-slot .profile-share button { width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 6px 8px; border: 1px solid rgba(148,229,255,.2); border-radius: 11px; color: #fff; background: rgba(148,229,255,.055); cursor: pointer; font-size: 11px; font-weight: 900; text-align: center; }
      .live-actions > button:disabled { opacity: .66; cursor: wait; }
      .live-actions .profile-action-primary { border-color: rgba(126,234,255,.48); background: linear-gradient(135deg, rgba(109,40,217,.86), rgba(11,148,201,.74)); box-shadow: 0 12px 30px rgba(49,46,129,.2), 0 0 18px rgba(34,199,255,.08); }
      .live-actions .profile-action-primary.profile-action-unavailable { border-color: rgba(148,137,166,.3); color: #bdb4ca; background: rgba(255,255,255,.055); }
      .live-actions .profile-action-going.profile-action-secondary { border-color: rgba(148,229,255,.26); background: linear-gradient(135deg, rgba(38,31,56,.82), rgba(18,33,44,.76)); box-shadow: none; }
      .profile-action-requires-account { flex-direction: column; gap: 1px; }
      .profile-action-requirement { color: #c7bbd8; font-size: 8px; font-weight: 850; line-height: 1.1; }
      .profile-action-share-slot { min-width: 0; }
      .profile-action-share-slot .profile-share { display: block; min-height: 44px; }
      .profile-action-share-slot .profile-share button { gap: 6px; }
      .profile-action-share-slot .profile-share svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; }
      .profile-action-share-slot .profile-share > span { display: block; color: #9fefff; font-size: 9px; text-align: center; }
      .profile-action-ride-slot { min-width: 0; }
      .profile-action-ride-slot > a, .profile-action-ride-slot > button { width: 100% !important; min-height: 44px !important; justify-content: center !important; padding-inline: 8px !important; border-radius: 11px !important; font-size: 10px !important; text-align: center !important; }
      .profile-action-ride-slot span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
      .profile-working-destination { min-height: 50px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 5px 7px; border-radius: 10px; color: inherit; text-decoration: none; }
      .profile-working-copy { min-width: 0; display: grid; gap: 1px; }
      .profile-working-copy small { color: #8f849c; font-size: 8px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
      .profile-working-copy strong { overflow: hidden; color: #fff; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
      .profile-working-copy em { overflow: hidden; color: #9c91aa; font-size: 9px; font-style: normal; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
      .profile-working-cue { color: #7eeaff; font-size: 26px; line-height: 1; }
      .profile-live-state, .eyebrow { width: fit-content; color: #94e5ff; font-size: 10px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .profile-live-state { padding: 6px 9px; border: 1px solid rgba(77,236,157,.48); border-radius: 999px; color: #b7ffd8; background: rgba(77,236,157,.1); letter-spacing: .08em; white-space: nowrap; }
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
      .profile-active-deal .club-deal-launcher { width: 100%; border-color: rgba(77,236,157,.74); background: linear-gradient(135deg, rgba(7,92,77,.72), rgba(8,72,44,.78)); box-shadow: 0 0 22px rgba(77,236,157,.14); }
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
      .profile-media-section { display: grid; gap: 4px; margin-top: 10px; padding-bottom: 24px; }
      .profile-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .profile-section-heading > div { display: grid; gap: 5px; }
      .profile-section-heading > span { color: #9487a5; font-size: 11px; font-weight: 850; }
      .profile-media-tabs { position: sticky; z-index: 20; top: 0; width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-self: stretch; gap: 0; padding: 0; border: 0; border-bottom: 1px solid rgba(255,255,255,.1); border-radius: 0; background: rgba(5,5,8,.94); box-shadow: 0 8px 18px rgba(0,0,0,.18); backdrop-filter: blur(16px); }
      body.dancr-button-system .public-profile-shell .profile-media-tabs button { position: relative; min-width: 0; min-height: 40px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border: 0 !important; border-radius: 0 !important; color: #968b9f; background: transparent !important; box-shadow: none !important; cursor: pointer; }
      body.dancr-button-system .public-profile-shell .profile-media-tabs button::before { content: none; }
      .profile-media-tab-icon { width: 16px; height: 16px; display: block; flex: 0 0 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .profile-media-tab-play { fill: currentColor; stroke: none; }
      .profile-media-tab-label { min-width: 0; overflow: hidden; font-size: 12px; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
      .profile-media-tab-count { min-width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #cfc7d8; background: rgba(255,255,255,.035); font-size: 9px; font-weight: 950; line-height: 1; }
      body.dancr-button-system .public-profile-shell .profile-media-tabs button.active { color: #fff !important; background: rgba(126,234,255,.045) !important; box-shadow: inset 0 -2px #7eeaff !important; text-shadow: none; }
      .profile-media-tabs button:disabled { opacity: .42; cursor: default; }
      .profile-media-grid { min-height: 108px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
      .profile-media-grid-item { position: relative; width: 100%; min-width: 0; aspect-ratio: 9 / 16; display: block; padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.08); border-radius: 3px; color: #fff; background: #0b0b10; box-shadow: none; cursor: pointer; }
      .profile-media-grid-item img, .profile-media-grid-item video { width: 100%; height: 100%; display: block; object-fit: cover; background: #000; pointer-events: none; }
      .profile-media-grid-item img { filter: brightness(1.14) contrast(1.03); opacity: 1; mix-blend-mode: normal; }
      .profile-media-poster-placeholder { width: 100%; height: 100%; display: block; background: radial-gradient(circle at 50% 32%, rgba(126,234,255,.18), transparent 28%), linear-gradient(145deg, rgba(109,40,217,.28), rgba(5,5,9,.96)); }
      .profile-media-grid-item:hover { border-color: rgba(126,234,255,.42); }
      .profile-media-grid-item:focus-visible { z-index: 1; outline: 2px solid #7eeaff; outline-offset: 2px; }
      .profile-media-play { position: absolute; top: 50%; left: 50%; width: 30px; aspect-ratio: 1; border-radius: 50%; background: rgba(255,255,255,.86); box-shadow: 0 7px 22px rgba(0,0,0,.36); transform: translate(-50%, -50%); }
      .profile-media-play::after { content: ""; position: absolute; top: 50%; left: 54%; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 9px solid #111; transform: translate(-50%, -50%); }
      .profile-media-duration { position: absolute; right: 6px; bottom: 6px; padding: 4px 6px; border-radius: 999px; color: #fff; background: rgba(0,0,0,.78); font-size: 9px; font-weight: 950; }
      .profile-media-grid-sentinel { position: relative; grid-column: 1 / -1; height: 28px; pointer-events: none; }
      .profile-media-grid-sentinel::after { position: absolute; top: 5px; left: 50%; width: 14px; height: 14px; content: ""; border: 2px solid rgba(126,234,255,.18); border-top-color: #7eeaff; border-radius: 50%; animation: profile-media-loading 700ms linear infinite; transform: translateX(-50%); }
      .profile-media-grid-status { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      .profile-media-empty { grid-column: 1 / -1; min-height: 108px; display: grid; place-items: center; color: #8f849c; text-align: center; }
      .profile-media-viewer { position: fixed; z-index: 1600; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; color: #fff; background: rgba(0,0,0,.98); overscroll-behavior: none; touch-action: none; }
      .profile-media-viewer-close { position: fixed; z-index: 3; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); width: 50px; height: 50px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(126,234,255,.42); border-radius: 50%; color: #fff; background: rgba(10,10,14,.78); font-size: 30px; cursor: pointer; backdrop-filter: blur(12px); }
      .profile-media-viewer-stage { position: relative; min-height: 0; display: grid; place-items: center; overflow: hidden; touch-action: none; }
      .profile-media-viewer-stage > img, .profile-media-viewer-stage > video { width: 100%; height: 100%; max-height: 100%; display: block; object-fit: contain; background: #000; user-select: none; }
      .profile-media-viewer-stage > img { filter: brightness(1.14) contrast(1.03); opacity: 1; mix-blend-mode: normal; }
      .profile-media-viewer-previous, .profile-media-viewer-next { position: absolute; top: 50%; width: 46px; height: 58px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #fff; background: rgba(5,5,8,.58); font-size: 34px; transform: translateY(-50%); cursor: pointer; backdrop-filter: blur(8px); }
      .profile-media-viewer-previous { left: 12px; }
      .profile-media-viewer-next { right: 12px; }
      .profile-media-viewer-previous:disabled, .profile-media-viewer-next:disabled { opacity: 0; pointer-events: none; }
      .profile-media-viewer-footer { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px max(18px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); border-top: 1px solid rgba(255,255,255,.1); background: #07070a; }
      .profile-media-viewer-copy { min-width: 0; display: grid; gap: 3px; }
      .profile-media-viewer-copy span { color: #aaa0b8; font-size: 12px; }
      .profile-media-viewer-actions { min-width: 92px; display: grid; justify-items: end; gap: 3px; }
      .profile-media-viewer-share { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 15px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; color: #fff; background: rgba(255,255,255,.08); font-size: 12px; font-weight: 900; cursor: pointer; backdrop-filter: blur(10px); }
      .profile-media-viewer-share svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.9; }
      .profile-media-viewer-share-status { min-height: 14px; color: #a7f3d0; font-size: 10px; font-weight: 800; text-align: right; }
      .profile-media-viewer-hint { color: #aaa0b8; font-size: 11px; font-weight: 800; }
      .profile-media-viewer { display: block; }
      .profile-media-viewer .profile-media-viewer-stage { width: 100%; height: 100%; }
      .profile-media-viewer.is-video .profile-media-viewer-stage > video { object-fit: cover; }
      .profile-media-viewer .profile-media-viewer-previous,
      .profile-media-viewer .profile-media-viewer-next { z-index: 2; left: auto; right: max(12px, env(safe-area-inset-right)); width: 48px; height: 48px; border-color: rgba(255,255,255,.2); background: rgba(8,8,12,.68); font-size: 22px; transform: none; }
      .profile-media-viewer .profile-media-viewer-previous { top: 34%; }
      .profile-media-viewer .profile-media-viewer-next { top: calc(34% + 58px); }
      .profile-media-viewer .profile-media-viewer-footer { position: absolute; z-index: 2; inset: 0; min-height: 0; display: block; padding: 0; border: 0; background: linear-gradient(0deg, rgba(0,0,0,.82) 0, rgba(0,0,0,.34) 14%, transparent 38%); pointer-events: none; }
      .profile-media-viewer .profile-media-viewer-copy { position: absolute; right: 82px; bottom: max(22px, calc(env(safe-area-inset-bottom) + 14px)); left: max(18px, env(safe-area-inset-left)); gap: 4px; text-shadow: 0 2px 8px rgba(0,0,0,.9); }
      .profile-media-viewer .profile-media-viewer-actions { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: max(22px, calc(env(safe-area-inset-bottom) + 14px)); min-width: 0; pointer-events: auto; }
      .profile-media-viewer .profile-media-viewer-share { width: 48px; min-width: 48px; min-height: 48px; flex-direction: column; gap: 2px; padding: 0; border-radius: 50%; font-size: 9px; }
      .profile-media-viewer .profile-media-viewer-share-status { position: absolute; right: 56px; bottom: 4px; width: max-content; max-width: 180px; text-shadow: 0 1px 5px #000; }
      .profile-media-viewer-preload { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
      .profile-media-viewer-preload img, .profile-media-viewer-preload video { width: 1px; height: 1px; }
      @keyframes profile-media-loading { to { transform: translateX(-50%) rotate(360deg); } }
      .profile-schedule-section { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(139,92,246,.27); border-radius: 18px; background: rgba(10,10,16,.84); }
      .shift-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
      .shift-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 14px; border: 1px solid rgba(255,255,255,.085); border-radius: 14px; color: #f7f2ff; background: rgba(255,255,255,.035); text-decoration: none; }
      .shift-date { grid-column: 1 / -1; color: #94e5ff; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .shift-row strong { min-width: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .shift-time { color: #b9accd; font-size: 11px; }
      .shift-row em { grid-column: 2; grid-row: 2 / span 2; align-self: center; padding: 6px 9px; border: 1px solid rgba(148,229,255,.22); border-radius: 999px; color: #94e5ff; background: rgba(148,229,255,.08); font-size: 9px; font-style: normal; font-weight: 950; text-transform: uppercase; }
      .profile-account-gate, .profile-report-gate, .profile-schedule-gate { position: fixed; inset: 0; z-index: 1700; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.8); backdrop-filter: blur(11px); }
      .profile-account-gate-dialog, .profile-report-dialog, .profile-schedule-dialog { position: relative; width: min(430px, 100%); max-height: calc(100dvh - 24px); display: grid; gap: 14px; padding: 24px; overflow-y: auto; border: 1px solid rgba(53,216,255,.42); border-radius: 16px; background: linear-gradient(145deg, #0b0b13, #060609); box-shadow: 0 28px 90px rgba(0,0,0,.72); }
      .profile-account-gate-dialog > span, .profile-report-dialog > span, .profile-schedule-dialog > span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .profile-account-gate-dialog h2, .profile-report-dialog h2 { padding-right: 40px; }
      .profile-account-gate-dialog > div { display: grid; gap: 10px; }
      .profile-account-gate-dialog a, .profile-report-dialog form > button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; text-decoration: none; }
      .profile-account-gate-dialog a.secondary { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); }
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
      .profile-report-error { color: #ffb4c8; }
      @media (max-width: 600px) {
        .public-profile-shell { padding: 0 12px max(132px, calc(108px + env(safe-area-inset-bottom))); }
        .profile-titlebar { min-height: 60px; }
        .profile-titlebar-avatar { width: 40px; height: 40px; flex-basis: 40px; }
        .live-actions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .live-actions.is-no-shift { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
        .club-deal-card { grid-template-columns: 1fr; }
        .profile-media-tab-label { font-size: 11px; }
        .profile-media-viewer-hint { display: none; }
      }
    `}</style>
  );
}
