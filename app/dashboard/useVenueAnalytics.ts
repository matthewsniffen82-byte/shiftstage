"use client";
import { useEffect, useState } from "react";
import { requestVenueDashboardJson } from "./dashboard-session";
import type { LoadState } from "./dashboard-types";

// Reports have their own request lifecycle. A failed or slow report must never
// stop the live roster, queues, or media counts from refreshing.
export function useVenueAnalytics(venueId: unknown, accountId: unknown, active: boolean,
  period: "tonight" | "7d" | "30d" | "all", refreshKey?: string | null) {
  const [snapshot, setSnapshot] = useState<{ venueId: unknown; accountId: unknown; period: string; data: LoadState["analytics"] } | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!active || !venueId) return;
    const controller = new AbortController();
    setStatus("Updating results…");
    void requestVenueDashboardJson(period, { view: "analytics", cache: "no-store", signal: controller.signal,
      timeoutMs: 15000, fallbackMessage: "Results could not update. Refresh to try again." })
      .then(data => {
        if (!controller.signal.aborted) { setSnapshot({ venueId, accountId, period, data: data.analytics }); setStatus(""); }
      }).catch(reason => {
        if (controller.signal.aborted) return;
        if ([401, 403].includes(Number(reason?.status))) setSnapshot(null);
        setStatus("Results could not update. Refresh to try again.");
      });
    return () => controller.abort();
  }, [venueId, accountId, active, period, refreshKey]);
  const analytics = snapshot?.venueId === venueId && snapshot?.accountId === accountId && snapshot?.period === period ? snapshot.data : undefined;
  return { analytics, status };
}
