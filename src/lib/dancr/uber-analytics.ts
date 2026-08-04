import type { UberRideSource } from "@/src/lib/dancr/uber-types";

export type UberRideAnalyticsEvent = {
  venueId: string;
  venueName: string;
  source: UberRideSource;
  city: string;
  dancerId?: string | null;
};

export function buildUberRideAnalyticsPayload(event: UberRideAnalyticsEvent) {
  return {
    type: "uber_ride_link_clicked" as const,
    venueId: event.venueId,
    venueName: event.venueName,
    ...(event.dancerId ? { dancerId: event.dancerId } : {}),
    source: event.source,
    city: event.city,
    timestamp: new Date().toISOString(),
    sessionId: analyticsSessionId(),
  };
}

export function trackUberRideLinkClicked(event: UberRideAnalyticsEvent): void {
  try {
    const body = JSON.stringify(buildUberRideAnalyticsPayload(event));
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/events",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }

    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.info("UBER_RIDE_ANALYTICS_SKIPPED", error);
    }
  }
}

function analyticsSessionId(): string | null {
  try {
    const key = "dancr_live_session_id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return null;
  }
}
