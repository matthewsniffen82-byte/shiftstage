"use client";

import type { MouseEvent } from "react";

const DASHBOARD_ROUTE = /^\/(?:admin|dashboard)(?:\/|$)/;
const HISTORY_FALLBACK_DELAY_MS = 900;

export function DashboardCloseButton({
  fallbackHref,
  label,
}: {
  fallbackHref: string;
  label: string;
}) {
  function navigateToFallback() {
    const destination = new URL(fallbackHref, window.location.origin);
    window.location.assign(destination.toString());
  }

  function closeDashboard(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const referrer = document.referrer;
    if (!referrer) return;

    try {
      const previousUrl = new URL(referrer);
      const canRestorePreviousPage =
        previousUrl.origin === window.location.origin
        && previousUrl.href !== window.location.href
        && !DASHBOARD_ROUTE.test(previousUrl.pathname)
        && window.history.length > 1;

      if (!canRestorePreviousPage) return;

      event.preventDefault();
      const fallbackTimer = window.setTimeout(
        navigateToFallback,
        HISTORY_FALLBACK_DELAY_MS,
      );
      window.addEventListener(
        "pagehide",
        () => window.clearTimeout(fallbackTimer),
        { once: true },
      );
      window.history.back();
    } catch {
      // The anchor's canonical discovery URL remains the safe fallback.
    }
  }

  return (
    <a
      aria-label={label}
      className="dancr-home-back"
      href={fallbackHref}
      onClick={closeDashboard}
    >
      <span aria-hidden="true">‹</span> Back to MyDancr
    </a>
  );
}
