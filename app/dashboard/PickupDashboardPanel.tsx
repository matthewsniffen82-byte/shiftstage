"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PICKUP_STATUS_LABELS, type PhonePickupRequest, type PickupRequest } from "@/src/lib/dancr/pickup-domain";
import { requestPickupJson } from "../pickups/pickup-session";

export default function PickupDashboardPanel() {
  const [requests, setRequests] = useState<PickupRequest[]>([]), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const [phoneRequests, setPhoneRequests] = useState<PhonePickupRequest[]>([]);
  useEffect(() => {
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try { const data = await requestPickupJson("/api/pickups?group=active", { signal: controller.signal });
        if (!controller.signal.aborted) { setRequests(data.requests.slice(0, 6)); setPhoneRequests((data.phoneRequests || []).slice(0, 6)); setError(""); setLoaded(true); }
      } catch { if (!controller.signal.aborted) { setRequests([]); setPhoneRequests([]); setError("Unable to load pickup requests. Open the pickup inbox to retry."); } }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  return <div><p>Customer pickup chats and phone requests.</p>
    <Link className="primary-link" href="/pickups">Open Pickup Requests →</Link>
    {error && <p role="alert">{error}</p>}{!loaded && !error && <p role="status">Loading pickup requests…</p>}
    {loaded && !error && !requests.length && !phoneRequests.length && <p>No active pickup requests.</p>}
    {phoneRequests.length > 0 && <><h3>Recent phone pickup requests</h3><div className="notification-list">{phoneRequests.map(request => <Link className="notification-row" key={request.id} href="/pickups">
      <strong>{request.venue_name} · {request.name}</strong>
      <span>{request.party_size} guests · {request.location}</span>
      <span>Open pickup requests for guest contact details.</span>
      <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString()}</time>
    </Link>)}</div></>}
    <div className="notification-list">{requests.map(request => <Link className="notification-row" key={request.id} href={`/pickups/${request.id}`}>
      <strong>{request.venue?.name || "Venue"} · {PICKUP_STATUS_LABELS[request.status]}</strong>
      <span>Guest {request.customer_user_id.slice(-6)} · {request.party_size} guests · {request.pickup_location_text}</span>
      <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString()}</time>
      {Boolean(request.unread_count) && <b>{request.unread_count} unread</b>}
    </Link>)}</div>
  </div>;
}
