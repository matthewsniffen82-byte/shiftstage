"use client";

import { useEffect } from "react";
import NfcIcon from "./NfcIcon";

const SESSION_KEY = "dancrVenueAnalyticsSessionV1";

type ClubDealAvailability = "no-active-offer" | "available-when-working" | "not-available-now";

// The export name remains stable for route compatibility while the visual and
// customer workflow have moved completely from QR to venue NFC.
export function VenueQrUnavailable({
  venueName,
  availability = "no-active-offer",
}: {
  venueName: string;
  availability?: ClubDealAvailability;
}) {
  const label = availability === "no-active-offer"
    ? "No Club Deal available"
    : availability === "available-when-working"
      ? "Club Deals available when working"
      : "No Club Deal available now";
  const detail = availability === "no-active-offer"
    ? "This club has no active Club Deal right now."
    : "No Club Deal is active for this dancer right now.";

  return (
    <aside className={`venue-qr-unavailable is-${availability}`} aria-label={`${label} for ${venueName}`}>
      <div className="venue-qr-unavailable-copy">
        <strong className="venue-qr-unavailable-label">Club Deal</strong>
        <small>{detail}</small>
      </div>
      <span className="venue-qr-placeholder-icon venue-nfc-placeholder-icon">
        <NfcIcon />
        <span className="venue-qr-placeholder-copy">
          <strong>Not active</strong>
          <small>Check back later</small>
        </span>
      </span>
    </aside>
  );
}

export function VenuePageView({ venueId }: { venueId: string }) {
  useEffect(() => {
    void recordEvent({ venueId, source: "venue_page", sessionId: analyticsSessionId(), eventType: "page_view" });
  }, [venueId]);
  return null;
}

function analyticsSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const value = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, value);
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

async function recordEvent(input: {
  venueId: string;
  eventType: "page_view";
  source: "venue_page";
  sessionId: string;
}) {
  await fetch("/api/public/venue-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => null);
}
