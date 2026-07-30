import Link from "next/link";
import { notFound } from "next/navigation";
import { ClubDealCard } from "@/app/components/ClubDealCard";
import { FloatingProfileHomeLink } from "@/app/components/FloatingProfileHomeLink";
import { VenuePageView, VenueQrCode } from "@/app/components/VenueQrCode";
import { TvVideoStrip } from "@/app/components/TvVideoStrip";
import { getActiveClubDealForVenue } from "@/src/lib/dancr/deals";
import { getVenueProfile, isApprovedPublicDancerRow } from "@/src/lib/dancr/public";
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
  dancer_profiles?: VenueDancer | VenueDancer[];
};

type PublicVenueShift = VenueShift & {
  dancer?: VenueDancer;
  photoUrl: string | null;
};

export default async function VenuePublicPage({ params }: PageProps) {
  const { slug } = await params;
  const client = createAdminSupabaseClient();
  const venue = await getVenueProfile(client, slug);
  if (!venue) notFound();

  const now = new Date();
  const nowIso = now.toISOString();
  const activeDeal = await getActiveClubDealForVenue(client, venue.id);
  const tvVideos = await getPublicMyDancrTvFeed(client, {
    city: venue.city,
    venueId: venue.id,
    limit: 6,
  });

  const { data, error } = await client
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
        verification_status,
        photo_review_status,
        is_public,
        dancer_photos(storage_path, is_primary, review_status, sort_order)
      )
    `)
    .eq("venue_id", venue.id)
    .eq("status", "posted")
    .gt("ends_at", nowIso)
    .order("starts_at", { ascending: true });

  if (error) throw error;

  const shifts = ((data || []) as VenueShift[])
    .map((shift): PublicVenueShift => {
      const dancer = Array.isArray(shift.dancer_profiles)
        ? shift.dancer_profiles[0]
        : shift.dancer_profiles;
      return {
        ...shift,
        dancer,
        photoUrl: approvedDancerPhotoUrl(client, dancer),
      };
    })
    .filter((shift) => isApprovedPublicDancerRow(shift.dancer));

  const workingNow = shifts.filter((shift) => isWorkingNow(shift, now));
  const upcoming = shifts.filter((shift) => new Date(shift.starts_at).getTime() > now.getTime());
  const location = [venue.city, venue.state].filter(Boolean).join(", ");
  const cityHref = `/?city=${encodeURIComponent(venue.city)}`;

  return (
    <main className={styles.shell}>
      <VenuePageView venueId={venue.id} />
      <FloatingProfileHomeLink city={venue.city} profileType="venue" />

      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Go to Mydancr home">
          mydanc<span>r</span>
        </Link>
        <Link className={styles.backLink} href={cityHref}>
          <span aria-hidden="true">←</span>
          Back to {venue.city}
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.venueMark} aria-hidden="true">
          {initials(venue.name)}
        </div>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            Mydancr venue
          </span>
          <h1>{venue.name}</h1>
          <p className={styles.location}>{location}</p>
          <div className={styles.heroFacts}>
            {workingNow.length ? (
              <span className={styles.workingNow}>
                <span aria-hidden="true" />
                {workingNow.length} {workingNow.length === 1 ? "dancer" : "dancers"} working now
              </span>
            ) : null}
            {venue.hoursLabel ? <span>Today · {venue.hoursLabel}</span> : null}
          </div>
          <div className={styles.primaryActions}>
            <Link href={`/tonight?city=${encodeURIComponent(venue.city)}`}>
              See who&apos;s working in {venue.city}
            </Link>
            {venue.address ? <DirectionsLink address={venue.address} venueId={venue.id} /> : null}
          </div>
          <VenueProfileActions venueId={venue.id} />
        </div>
      </section>

      {activeDeal ? (
        <section className={styles.dealSection} aria-label={`${venue.name} Club Deal`}>
          <ClubDealCard
            deal={activeDeal}
            venueId={venue.id}
            venueName={venue.name}
            sourceType="club_page"
            sectionId="club-deal"
            stickyCta
          />
        </section>
      ) : null}

      <section className={styles.scheduleSection}>
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
              <DancerShiftCard key={shift.id} shift={shift} mode="now" />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyPulse} aria-hidden="true" />
            <div>
              <strong>No verified dancers are working now.</strong>
              <p>Check the upcoming schedule below or return later for live check-ins.</p>
            </div>
          </div>
        )}
      </section>

      <section className={styles.scheduleSection}>
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
              <DancerShiftCard key={shift.id} shift={shift} mode="upcoming" />
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.calendarIcon} aria-hidden="true">+</span>
            <div>
              <strong>No upcoming shifts are posted.</strong>
              <p>Published dancer shifts will appear here as soon as they are available.</p>
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
            <div className={styles.infoDirections}>
              <DirectionsLink address={venue.address} venueId={venue.id} />
            </div>
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

      {venue.qrCodeUrl ? (
        <section className={styles.qrSection}>
          <VenueQrCode
            venueId={venue.id}
            venueName={venue.name}
            imageUrl={venue.qrCodeUrl}
            label={venue.qrCodeLabel}
            source="venue_page"
          />
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
  const href = shift.dancer?.slug ? `/dancers/${encodeURIComponent(shift.dancer.slug)}` : "";
  const card = (
    <>
      <div
        className={`${styles.dancerPhoto}${shift.photoUrl ? ` ${styles.hasPhoto}` : ""}`}
        style={shift.photoUrl ? { backgroundImage: `url("${cssUrl(shift.photoUrl)}")` } : undefined}
        aria-hidden="true"
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

  if (!href) return <article className={styles.dancerShiftCard}>{card}</article>;
  return (
    <Link className={styles.dancerShiftCard} href={href} aria-label={`Open ${name}'s profile`}>
      {card}
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

function isWorkingNow(shift: VenueShift, now: Date) {
  if (shift.checked_out_at) return false;
  const isConfirmed =
    shift.location_status === "club_confirmed" ||
    (shift.location_status === "location_confirmed" && Boolean(shift.checked_in_at));
  if (!isConfirmed) return false;

  const nowTime = now.getTime();
  const startsAt = new Date(shift.starts_at).getTime();
  const endsAt = new Date(shift.ends_at).getTime();
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= nowTime && endsAt > nowTime;
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
  return client.storage.from("dancer-photos").getPublicUrl(photo.storage_path).data.publicUrl;
}

function formatShift(startsAt: string, timeZone?: string | null) {
  const start = new Date(startsAt);
  if (!Number.isFinite(start.getTime())) return "Upcoming";

  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined,
    }).format(start);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(start);
  }
}

function cssUrl(value: string) {
  return value.replace(/["\\\n\r\f]/g, (character) => `\\${character}`);
}
