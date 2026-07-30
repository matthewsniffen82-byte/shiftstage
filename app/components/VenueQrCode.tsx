"use client";

import { useEffect, useState } from "react";

type VenueQrCodeProps = {
  venueId: string;
  venueName: string;
  imageUrl: string;
  label?: string | null;
  source: "venue_page" | "dancer_profile";
  dancerId?: string | null;
  recordPageView?: boolean;
  compact?: boolean;
  tapToShow?: boolean;
};

const SESSION_KEY = "dancrVenueAnalyticsSessionV1";

export function VenueQrCode({
  venueId,
  venueName,
  imageUrl,
  label,
  source,
  dancerId,
  recordPageView = false,
  compact = false,
  tapToShow = false,
}: VenueQrCodeProps) {
  const [visible, setVisible] = useState(!tapToShow);

  useEffect(() => {
    if (!recordPageView) return;
    const sessionId = analyticsSessionId();
    void recordEvent({ venueId, dancerId, source, sessionId, eventType: "page_view" });
  }, [dancerId, recordPageView, source, venueId]);

  useEffect(() => {
    if (!visible) return;
    const sessionId = analyticsSessionId();
    void recordEvent({ venueId, dancerId, source, sessionId, eventType: "qr_impression" });
  }, [dancerId, source, venueId, visible]);

  useEffect(() => {
    if (!tapToShow || !visible) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVisible(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [tapToShow, visible]);

  if (tapToShow && !visible) {
    return (
      <button
        className="venue-qr-launcher"
        onClick={() => setVisible(true)}
        type="button"
      >
        <span>Venue QR</span>
        <strong>Show venue QR</strong>
      </button>
    );
  }

  const qr = (
    <section className={compact ? "venue-published-qr compact" : "venue-published-qr"} aria-label={`${venueName} QR code`}>
      <div>
        <span className="eyebrow">Venue QR</span>
        <h2>{label || `${venueName} QR code`}</h2>
        <p>Scan the venue-published QR code.</p>
      </div>
      <img src={imageUrl} alt={`${venueName} venue QR code`} loading="lazy" decoding="async" />
    </section>
  );

  if (!tapToShow) return qr;

  return (
    <div
      className="venue-qr-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setVisible(false);
      }}
    >
      <section
        aria-label={`${venueName} QR code`}
        aria-modal="true"
        className="venue-qr-dialog"
        role="dialog"
      >
        <button
          aria-label="Close venue QR code"
          autoFocus
          className="venue-qr-dialog-close"
          onClick={() => setVisible(false)}
          type="button"
        >
          ×
        </button>
        {qr}
      </section>
    </div>
  );
}

export function VenueQrUnavailable({ venueName }: { venueName: string }) {
  return (
    <aside className="venue-qr-unavailable" aria-label={`Club Scan unavailable at ${venueName}`}>
      <span className="eyebrow">Club Scan</span>
      <p>Club Scan unavailable at this venue.</p>
    </aside>
  );
}

export function VenuePageView({ venueId }: { venueId: string }) {
  useEffect(() => {
    void recordEvent({
      venueId,
      source: "venue_page",
      sessionId: analyticsSessionId(),
      eventType: "page_view",
    });
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
  dancerId?: string | null;
  eventType: "page_view" | "qr_impression";
  source: "venue_page" | "dancer_profile";
  sessionId: string;
}) {
  await fetch("/api/public/venue-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => null);
}
