"use client";

type DirectionsLinkProps = {
  venueId: string;
  address: string;
};

export function DirectionsLink({ venueId, address }: DirectionsLinkProps) {
  function recordDirectionRequest() {
    const body = JSON.stringify({
      type: "direction_request",
      venueId,
      source: "public_venue",
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
      className="directions-link"
      href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
      onClick={recordDirectionRequest}
      rel="noreferrer"
      target="_blank"
    >
      Get directions
    </a>
  );
}
