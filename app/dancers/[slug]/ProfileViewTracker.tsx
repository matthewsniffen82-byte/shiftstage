"use client";

import { useEffect } from "react";

type ProfileViewTrackerProps = {
  dancerId: string;
  hasSchedule: boolean;
};

export function ProfileViewTracker({ dancerId, hasSchedule }: ProfileViewTrackerProps) {
  useEffect(() => {
    recordEvent({ type: "profile_view", dancerId, source: "public_profile" });

    if (hasSchedule) {
      recordEvent({ type: "schedule_view", dancerId, source: "public_profile" });
    }
  }, [dancerId, hasSchedule]);

  return null;
}

function recordEvent(payload: Record<string, string | boolean>) {
  const body = JSON.stringify(payload);

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
