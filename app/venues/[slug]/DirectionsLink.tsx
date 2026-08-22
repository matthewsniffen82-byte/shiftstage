"use client";

import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";

type DirectionsLinkProps = {
  venueId: string;
  address: string;
};

export function DirectionsLink({ venueId, address }: DirectionsLinkProps) {
  function recordDirectionRequest() {
    const token = readBrowserAccessToken();
    if (token) {
      fetch("/api/customer/directions", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ venueId }),
        keepalive: true,
      }).catch(() => undefined);
    }

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
