"use client";

import styles from "./UberRideButton.module.css";
import type { PublicVenueDestination } from "@/src/lib/dancr/uber";
import type { UberRideSource } from "@/src/lib/dancr/uber-types";

type UberRideVenue = PublicVenueDestination & {
  id: string;
  isActive?: boolean;
  isPublic?: boolean;
};

type UberRideButtonProps = {
  venue: UberRideVenue;
  source: UberRideSource;
  dancerId?: string | null;
  compact?: boolean;
};

const sourceClass: Record<UberRideSource, string> = {
  venue_page: styles.venuePage,
  dancer_profile: styles.dancerProfile,
  tonight_feed: styles.tonightFeed,
};

// Retain the existing component and CSS names for profile layout compatibility.
export function UberRideButton({ venue, source, compact = false }: UberRideButtonProps) {
  if (venue.isActive === false || venue.isPublic === false) return null;

  const venueName = String(venue.name || "this club").trim() || "this club";
  const label = rideActionLabel(source, venueName);
  const visibleLabel = compact ? "Free ride" : label;

  if (!venue.id) return null;

  return (
    <a
      aria-label={`${label}. Request the club’s free shuttle. The club will contact you to arrange pickup.`}
      className={`${styles.button} ${sourceClass[source]}`}
      href={`/rides/${encodeURIComponent(venue.id)}`}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <RideIcon />
      <span>{visibleLabel}</span>
    </a>
  );
}

function rideActionLabel(source: UberRideSource, venueName: string) {
  return source === "dancer_profile" ? `Free ride to ${venueName}` : "Free ride";
}

function RideIcon() {
  return (
    <svg aria-hidden="true" className={styles.icon} viewBox="0 0 24 24">
      <path d="m5 11 1.7-4.3A2.7 2.7 0 0 1 9.2 5h5.6a2.7 2.7 0 0 1 2.5 1.7L19 11" />
      <path d="M4 11h16a1 1 0 0 1 1 1v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a1 1 0 0 1 1-1Z" />
      <path d="M6.5 15h.01M17.5 15h.01M6 19v2M18 19v2" />
    </svg>
  );
}
