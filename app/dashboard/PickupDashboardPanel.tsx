"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PhonePickupRequest } from "@/src/lib/dancr/pickup-domain";
import { requestPickupJson } from "../pickups/pickup-session";

export default function PickupDashboardPanel({ refreshKey }: { refreshKey?: string | null }) {
  const [requests, setRequests] = useState<PhonePickupRequest[]>([]), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const data = await requestPickupJson("/api/pickups", { signal: controller.signal });
        if (!controller.signal.aborted) { setRequests(data.phoneRequests.slice(0, 6)); setError(""); setLoaded(true); }
      } catch { if (!controller.signal.aborted) { setRequests([]); setError("Unable to load pickup requests. Open the pickup inbox to retry."); } }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshKey]);
  const requestRow = (request: PhonePickupRequest, index: number) => <Link className={`notification-row venue-pickup-row${index === 0 ? " is-latest" : ""}`} key={request.id} href="/pickups">
    <span className="venue-pickup-row-heading"><strong>{request.name}</strong>{index === 0 ? <small>Latest</small> : null}</span>
    <span>{request.venue_name}</span>
    <span>{request.party_size} {request.party_size === 1 ? "guest" : "guests"} · {request.location}</span>
    <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
  </Link>;
  return <div className="venue-pickup-preview"><p>Recent pickup requests. Open the inbox to contact guests and arrange their ride.</p>
    {error && <p role="alert">{error}</p>}{!loaded && !error && <p role="status">Loading pickup requests…</p>}
    {loaded && !error && !requests.length && <div className="dashboard-empty-state"><strong>No pickup requests yet</strong><p>Guest requests will appear here.</p></div>}
    <div className="notification-list">{requests.slice(0, 3).map(requestRow)}</div>
    {requests.length > 3 && <details><summary>Earlier requests</summary><div className="notification-list">{requests.slice(3).map((request, index) => requestRow(request, index + 3))}</div></details>}
    <Link className="primary-link dashboard-primary-action" href="/pickups">Open pickup inbox →</Link>
  </div>;
}
