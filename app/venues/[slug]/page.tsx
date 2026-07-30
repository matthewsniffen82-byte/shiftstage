import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { FloatingProfileHomeLink } from "@/app/components/FloatingProfileHomeLink";
import { PublicProfileHeader } from "@/app/components/PublicProfileHeader";
import { VenuePageView, VenueQrCode } from "@/app/components/VenueQrCode";
import { TvVideoStrip } from "@/app/components/TvVideoStrip";
import { ProfileCloseButton } from "@/app/dancers/[slug]/ProfileNavigationActions";
import { getActiveClubDealForVenue } from "@/src/lib/dancr/deals";
import {
  formatVenueHours,
  getVenueProfile,
  isApprovedPublicDancerRow,
} from "@/src/lib/dancr/public";
import { getPublicMyDancrTvFeed } from "@/src/lib/dancr/tv";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { DirectionsLink } from "./DirectionsLink";
import styles from "./VenueProfile.module.css";
import { VenueProfileActions } from "./VenueProfileActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

type VenueDancer = {
  slug?: string;
  stage_name?: string;
  status?: string;
  approved_at?: string;
  verification_status?: string;
  photo_review_status?: string;
  disabled_at?: string | null;
  is_public?: boolean;
  dancer_photos?: Array<{
    storage_path?: string;
    is_primary?: boolean;
    review_status?: string;
    sort_order?: number;
  }>;
};

type VenueShift = {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone?: string | null;
  location_status?: string | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  dancer_profiles?: VenueDancer | VenueDancer[] | null;
};

type PublicVenueShift = VenueShift & {
  dancer?: VenueDancer;
  photoUrl: string | null;
};

type RelatedVenue = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state?: string | null;
  address?: string | null;
  hoursLabel: string | null;
};

export default async function VenuePublicPage({ params }: PageProps) {
  const { slug } = await params;
  const client = createAdminSupabaseClient();
  const venue = await getVenueProfile(client, slug);
  if (!venue) notFound();

  const now = new Date();
  const nowIso = now.toISOString();
  const [activeDeal, tvVideos, shiftResult, relatedResult] = await Promise.all([
    getActiveClubDealForVenue(client, venue.id),
    getPublicMyDancrTvFeed(client, {
      city: venue.city,
      venueId: venue.id,
      limit: 6,
    }),
    client
      .from("shifts")
      .select(`
        id,
        starts_at,
        ends_at,
        timezone,
        location_status,
        checked_in_at,
        checked_out_at,
        dancer_profiles(
          slug,
          stage_name,
          status,
          approved_at,
          disabled_at,
          verification_status,
          photo_review_status,
          is_public,
          dancer_photos(storage_path, is_primary, review_status, sort_order)
        )
      `)
      .eq("venue_id", venue.id)
      .eq("status", "posted")
      .gt("ends_at", nowIso)
      .order("starts_at", { ascending: true }),
    client
      .from("venues")
      .select("id, slug, name, city, state, address, opens_at, closes_at")
      .eq("is_active", true)
      .ilike("city", venue.city)
      .neq("id", venue.id)
      .order("name", { ascending: true })
      .limit(6),
  ]);

  if (shiftResult.error) throw shiftResult.error;
  if (relatedResult.error) throw relatedResult.error;

  const shifts = ((shiftResult.data || []) as VenueShift[])
    .map((shift): PublicVenueShift => {
      const dancer = Array.isArray(shift.dancer_profiles)
        ? shift.dancer_profiles[0]
        : shift.dancer_profiles || undefined;
      return {
        ...shift,
        dancer,
        photoUrl: approvedDancerPhotoUrl(client, dancer),
      };
    })
    .filter((shift) => isApprovedPublicDancerRow(shift.dancer));
  const workingNow = shifts.filter((shift) => isWorkingNow(shift, now));
  const upcoming = shifts.filter(
    (shift) => new Date(shift.starts_at).getTime() > now.getTime(),
  );
  const relatedVenues: RelatedVenue[] = (relatedResult.data || []).map(
    (item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      city: item.city,
      state: item.state,
      address: item.address,
      hoursLabel: formatVenueHours(item.opens_at, item.closes_at),
    }),
  );
  const location = [venue.city, venue.state].filter(Boolean).join(", ");
  const venuesHref = `/venues?city=${encodeURIComponent(venue.city)}`;

  return (
    <main className={styles.shell}>
      <VenuePageView venueId={venue.id} />
      <FloatingProfileHomeLink city={venue.city} profileType="venue" />
      <PublicProfileHeader
        city={venue.city}
        closeControl={
          <ProfileCloseButton
            fallbackHref={venuesHref}
            profileType="venue"
          />
        }
      />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <Link className={styles.backLink} href={venuesHref}>
            ← Back to venues
          </Link>
          <span
            className={`${styles.liveState}${workingNow.length ? ` ${styles.isWorking}` : ""}`}
          >
            {workingNow.length
              ? `${workingNow.length} ${workingNow.length === 1 ? "dancer" : "dancers"} working now`
              : "Verified venue"}
          </span>
          <span className={styles.eyebrow}>Mydancr venue</span>
          <h1>{venue.name}</h1>
          <p className={styles.location}>{location}</p>

          <div className={styles.primaryActions}>
            {activeDeal ? (
              <ClubDealCard
                ctaLabel="Show Club QR"
                deal={activeDeal}
                presentation="launcher"
                sourceType="club_page"
                venueId={venue.id}
                venueName={venue.name}
              />
            ) : venue.qrCodeUrl ? (
              <VenueQrCode
                compact
                imageUrl={venue.qrCodeUrl}
                label={venue.qrCodeLabel}
                source="venue_page"
                tapToShow
                venueId={venue.id}
                venueName={venue.name}
              />
            ) : null}
            {venue.address ? (
              <DirectionsLink address={venue.address} venueId={venue.id} />
            ) : null}
          </div>
          <VenueProfileActions venueId={venue.id} venueName={venue.name} />
        </div>

        <aside className={styles.tonightCard} aria-label={`${venue.name} tonight`}>
          <span className={styles.eyebrow}>Tonight</span>
          <strong>{venue.hoursLabel || "Hours not posted"}</strong>
          <p>{venue.address || location}</p>
          <div className={styles.tonightStats}>
            <a href="#working-now">
              <strong>{workingNow.length}</strong>
              <span>working now</span>
            </a>
            <a href="#upcoming-shifts">
              <strong>{upcoming.length}</strong>
              <span>upcoming</span>
            </a>
          </div>
          {activeDeal ? (
            <div className={styles.dealSummary}>
              <span>Club Deal</span>
              <strong>{activeDeal.dealTitle}</strong>
              <p>{activeDeal.dealDescription}</p>
            </div>
          ) : null}
        </aside>
      </section>

      <section className={styles.scheduleSection} id="working-now">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Live roster</span>
            <h2>Working now</h2>
          </div>
          {workingNow.length ? (
            <span className={styles.sectionCount}>{workingNow.length} live</span>
          ) : null}
        </div>
        {workingNow.length ? (
          <div className={styles.dancerGrid}>
            {workingNow.map((shift) => (
              <DancerShiftCard key={shift.id} mode="now" shift={shift} />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyPulse} aria-hidden="true" />
            <div>
              <strong>No verified dancers are working now.</strong>
              <p>Check the upcoming schedule below for posted shifts.</p>
            </div>
          </div>
        )}
      </section>

      <section className={styles.scheduleSection} id="upcoming-shifts">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Plan your visit</span>
            <h2>Upcoming shifts</h2>
          </div>
          {upcoming.length ? (
            <span className={styles.sectionCount}>
              {upcoming.length} {upcoming.length === 1 ? "shift" : "shifts"}
            </span>
          ) : null}
        </div>
        {upcoming.length ? (
          <div className={styles.upcomingList}>
            {upcoming.map((shift) => (
              <DancerShiftCard key={shift.id} mode="upcoming" shift={shift} />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.calendarIcon} aria-hidden="true">+</span>
            <div>
              <strong>No upcoming shifts are posted.</strong>
              <p>Published dancer shifts will appear here automatically.</p>
            </div>
          </div>
        )}
      </section>

      {tvVideos.length ? (
        <section className={styles.tvSection}>
          <TvVideoStrip title={`Tonight at ${venue.name}`} videos={tvVideos} />
        </section>
      ) : null}

      <section className={styles.venueInfoSection}>
        <article className={styles.infoCard}>
          <span className={styles.eyebrow}>Venue information</span>
          <h2>Plan your night</h2>
          <dl className={styles.factList}>
            <div>
              <dt>Location</dt>
              <dd>{location}</dd>
            </div>
            {venue.address ? (
              <div>
                <dt>Address</dt>
                <dd>{venue.address}</dd>
              </div>
            ) : null}
            {venue.hoursLabel ? (
              <div>
                <dt>Today&apos;s hours</dt>
                <dd>{venue.hoursLabel}</dd>
              </div>
            ) : null}
          </dl>
          {venue.address ? (
            <DirectionsLink address={venue.address} venueId={venue.id} />
          ) : null}
        </article>
        {venue.address ? (
          <section className={styles.mapPanel} aria-label={`${venue.name} map preview`}>
            <iframe
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`/api/public/maps/embed?address=${encodeURIComponent(venue.address)}`}
              title={`${venue.name} map preview`}
            />
          </section>
        ) : null}
      </section>

      {relatedVenues.length ? (
        <section className={styles.relatedSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>{venue.city}</span>
              <h2>Other venues</h2>
            </div>
            <Link className={styles.viewAllLink} href={venuesHref}>
              View all
            </Link>
          </div>
          <div className={styles.relatedScroller}>
            {relatedVenues.map((item) => (
              <Link
                className={styles.relatedCard}
                href={`/venues/${encodeURIComponent(item.slug)}`}
                key={item.id}
              >
                <span aria-hidden="true">{initials(item.name)}</span>
                <strong>{item.name}</strong>
                <small>{item.address || [item.city, item.state].filter(Boolean).join(", ")}</small>
                {item.hoursLabel ? <em>{item.hoursLabel}</em> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function DancerShiftCard({
  shift,
  mode,
}: {
  shift: PublicVenueShift;
  mode: "now" | "upcoming";
}) {
  const name = shift.dancer?.stage_name || "Dancer";
  const href = shift.dancer?.slug
    ? `/dancers/${encodeURIComponent(shift.dancer.slug)}`
    : "";
  const content = (
    <>
      <div
        aria-hidden="true"
        className={`${styles.dancerPhoto}${shift.photoUrl ? ` ${styles.hasPhoto}` : ""}`}
        style={
          shift.photoUrl
            ? { backgroundImage: `url("${cssUrl(shift.photoUrl)}")` }
            : undefined
        }
      >
        {!shift.photoUrl ? name.charAt(0).toUpperCase() : null}
      </div>
      <div className={styles.dancerCopy}>
        <strong>{name}</strong>
        {mode === "now" ? (
          <span className={styles.liveLabel}>
            <span aria-hidden="true" />
            Working now
          </span>
        ) : (
          <span>{formatShift(shift.starts_at, shift.timezone)}</span>
        )}
      </div>
      <span className={styles.cardArrow} aria-hidden="true">›</span>
    </>
  );
  if (!href) return <article className={styles.dancerShiftCard}>{content}</article>;
  return (
    <Link
      aria-label={`Open ${name}'s full dancer profile`}
      className={styles.dancerShiftCard}
      href={href}
    >
      {content}
    </Link>
  );
}

function isWorkingNow(shift: VenueShift, now: Date) {
  if (shift.checked_out_at) return false;
  const confirmed =
    shift.location_status === "club_confirmed" ||
    (shift.location_status === "location_confirmed" && Boolean(shift.checked_in_at));
  if (!confirmed) return false;
  const startsAt = new Date(shift.starts_at).getTime();
  const endsAt = new Date(shift.ends_at).getTime();
  const nowTime = now.getTime();
  return startsAt <= nowTime && endsAt > nowTime;
}

function approvedDancerPhotoUrl(
  client: ReturnType<typeof createAdminSupabaseClient>,
  dancer?: VenueDancer,
) {
  const photo = [...(dancer?.dancer_photos || [])]
    .filter((item) => item.review_status === "approved" && item.storage_path)
    .sort((left, right) => {
      if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    })[0];
  if (!photo?.storage_path) return null;
  if (/^https?:\/\//i.test(photo.storage_path)) return photo.storage_path;
  return client.storage
    .from("dancer-photos")
    .getPublicUrl(photo.storage_path).data.publicUrl;
}

function formatShift(startsAt: string, timeZone?: string | null) {
  const start = new Date(startsAt);
  if (!Number.isFinite(start.getTime())) return "Upcoming";
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      ...(timeZone ? { timeZone } : {}),
    }).format(start);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(start);
  }
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function cssUrl(value: string) {
  return value.replace(/["\\\n\r\f]/g, (character) => `\\${character}`);
}
