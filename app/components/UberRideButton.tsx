"use client";

import styles from "./UberRideButton.module.css";
import {
  buildUberRideUrl,
  isValidUberDestination,
  publicVenueUberDestination,
  type PublicVenueDestination,
} from "@/src/lib/dancr/uber";
import { trackUberRideLinkClicked } from "@/src/lib/dancr/uber-analytics";
import type { UberRideSource } from "@/src/lib/dancr/uber-types";
import { isFictionalVenueTravelPreviewOnly } from "@/src/lib/dancr/venue-branding";

type UberRideVenue = PublicVenueDestination & {
  id: string;
  isActive?: boolean;
  isPublic?: boolean;
};

type UberRideButtonProps = {
  venue: UberRideVenue;
  source: UberRideSource;
  dancerId?: string | null;
};

const sourceClass: Record<UberRideSource, string> = {
  venue_page: styles.venuePage,
  dancer_profile: styles.dancerProfile,
  tonight_feed: styles.tonightFeed,
};

export function UberRideButton({ venue, source, dancerId }: UberRideButtonProps) {
  if (venue.isActive === false || venue.isPublic === false) return null;

  const venueName = String(venue.name || "this club").trim() || "this club";
  const label = source === "venue_page"
    ? "Request Uber"
    : source === "dancer_profile"
      ? `Ride to ${venueName}`
      : "Get a Ride";

  if (isFictionalVenueTravelPreviewOnly(venue)) {
    return (
      <button
        aria-disabled="true"
        aria-label={`${label}. Preview only.`}
        className={`${styles.button} ${sourceClass[source]}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        tabIndex={-1}
        type="button"
      >
        <RideIcon />
        <span>{label}</span>
      </button>
    );
  }

  const destination = publicVenueUberDestination(venue);
  if (!isValidUberDestination(destination)) return null;

  return (
    <a
      aria-label={`${label}. Opens Uber with ${destination.formattedAddress} as the destination.`}
      className={`${styles.button} ${sourceClass[source]}`}
      href={buildUberRideUrl(destination)}
      onClick={(event) => {
        event.stopPropagation();
        trackUberRideLinkClicked({
          venueId: venue.id,
          venueName: destination.name,
          dancerId: source === "venue_page" ? null : dancerId,
          source,
          city: venue.city?.trim() || "",
        });
      }}
      rel="noopener noreferrer"
      target="_blank"
    >
      <RideIcon />
      <span>{label}</span>
    </a>
  );
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
