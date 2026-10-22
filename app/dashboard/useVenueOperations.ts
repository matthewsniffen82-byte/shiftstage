"use client";
import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { VENUE_OPERATIONS_CHANGED, type VenueOperations } from "@/src/lib/dancr/venue-operations";

export function useVenueOperations(venueId: unknown, refreshKey?: string | null) {
  const [snapshot, setSnapshot] = useState<{ venueId: unknown; operations: VenueOperations } | null>(null);
  const operations = snapshot && snapshot.venueId === venueId ? snapshot.operations : null;
  const [error, setError] = useState("");
  useEffect(() => {
    setSnapshot(null); setError("");
  }, [venueId]);
  useEffect(() => {
    if (!venueId) return;
    let controller: AbortController | null = null, closed = false;
    async function refresh() {
      if (closed || controller || document.visibilityState === "hidden") return;
      const request = new AbortController(); controller = request;
      try {
        const data = await requestDashboardJson("/api/venue/operations", { expectedRole: "venue", cache: "no-store", signal: request.signal, timeoutMs: 15000 });
        if (!closed && !request.signal.aborted) { setSnapshot({ venueId, operations: data.operations }); setError(""); }
      } catch (reason) {
        if (!closed && !request.signal.aborted) {
          if (reason && typeof reason === "object" && "status" in reason && [401, 403].includes(Number(reason.status))) setSnapshot(null);
          setError("Live queues could not update. Refresh to try again.");
        }
      } finally { if (controller === request) controller = null; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener(VENUE_OPERATIONS_CHANGED, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { closed = true; controller?.abort(); window.clearInterval(timer); window.removeEventListener(VENUE_OPERATIONS_CHANGED, refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [venueId, refreshKey]);
  return { operations, error };
}
