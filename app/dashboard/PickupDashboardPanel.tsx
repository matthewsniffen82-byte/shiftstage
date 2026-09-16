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
  return <div><p>Contact these guests directly to arrange and confirm pickup.</p>
    <Link className="primary-link" href="/pickups">Open Pickup Requests →</Link>
    {error && <p role="alert">{error}</p>}{!loaded && !error && <p role="status">Loading pickup requests…</p>}
    {loaded && !error && !requests.length && <p>No pickup requests yet.</p>}
    <div className="notification-list">{requests.map(request => <Link className="notification-row" key={request.id} href="/pickups">
      <strong>{request.venue_name} · {request.name}</strong>
      <span>{request.party_size} guests · {request.location}</span>
      <span>Open pickup requests for guest contact details.</span>
      <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString()}</time>
    </Link>)}</div>
  </div>;
}
