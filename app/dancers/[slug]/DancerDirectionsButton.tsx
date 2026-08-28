"use client";

import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";
import { formatPublicVenueAddress } from "@/src/lib/dancr/uber";

type DancerDirectionsVenue = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string;
  state: string | null;
};

export function DancerDirectionsButton({
  dancerId,
  venue,
}: {
  dancerId: string;
  venue: DancerDirectionsVenue;
}) {
  const address = formatPublicVenueAddress(venue);
  const label = `Directions to ${venue.name}`;

  if (!address) {
    return (
      <button
        aria-disabled="true"
        aria-label={`Directions unavailable for ${venue.name}`}
        className="profile-directions-button"
        disabled
        type="button"
      >
        <DirectionsIcon />
        <span>Directions</span>
      </button>
    );
  }

  function recordDirectionRequest() {
    const token = readBrowserAccessToken("customer");
    if (token) {
      fetch("/api/customer/directions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: venue.id, dancerIds: [dancerId] }),
        keepalive: true,
      }).catch(() => recordPublicDirectionEvent());
      return;
    }
    recordPublicDirectionEvent();
  }

  function recordPublicDirectionEvent() {
    const body = JSON.stringify({
      type: "direction_request",
      venueId: venue.id,
      dancerId,
      source: "dancer_profile",
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }

  return (
    <a
      aria-label={label}
      className="profile-directions-button"
      href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
      onClick={recordDirectionRequest}
      rel="noreferrer"
      target="_blank"
    >
      <DirectionsIcon />
      <span>Directions</span>
    </a>
  );
}

function DirectionsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.4" />
    </svg>
  );
}
