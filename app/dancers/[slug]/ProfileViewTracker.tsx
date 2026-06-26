"use client";

import { useEffect } from "react";

type ProfileViewTrackerProps = {
  dancerId: string;
};

export function ProfileViewTracker({ dancerId }: ProfileViewTrackerProps) {
  useEffect(() => {
    const body = JSON.stringify({
      type: "profile_view",
      dancerId,
      source: "public_profile",
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
  }, [dancerId]);

  return null;
}
