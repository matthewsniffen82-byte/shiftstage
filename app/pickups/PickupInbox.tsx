"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PhonePickupRequest, PickupVenue } from "@/src/lib/dancr/pickup-domain";
import { PickupAccountGate, requestPickupJson } from "./pickup-session";

export default function PickupInbox() {
  return <PickupAccountGate>{role => <Inbox role={role} />}</PickupAccountGate>;
}
function Inbox({ role }: { role: "venue" | "admin" }) {
  const [requests, setRequests] = useState<PhonePickupRequest[]>([]), [venues, setVenues] = useState<PickupVenue[]>([]);
  const [venueId, setVenueId] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const paginationLock = useRef(false), mounted = useRef(false), queryRef = useRef("");
  const query = new URLSearchParams({ ...(venueId ? { venueId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  queryRef.current = query;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void requestPickupJson("/api/pickups/settings", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setVenues(data.venues); })
      .catch(() => { /* Requests remain available when the optional venue filter fails. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setRequests([]); setMore(false);
    void requestPickupJson("/api/pickups?" + query, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setRequests(data.phoneRequests); setMore(data.hasMorePhoneRequests); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load pickup requests."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);
  async function loadMore() {
    if (paginationLock.current) return;
    paginationLock.current = true; setLoading(true); setError("");
    const expectedQuery = query;
    try {
      const data = await requestPickupJson("/api/pickups?" + query + "&phoneOffset=" + requests.length);
      if (mounted.current && expectedQuery === queryRef.current) {
        setRequests(current => [...new Map([...current, ...data.phoneRequests].map(r => [r.id, r])).values()]); setMore(data.hasMorePhoneRequests);
      }
    } catch (failure) { if (mounted.current && expectedQuery === queryRef.current) setError(failure instanceof Error ? failure.message : "Unable to load more pickups."); }
    finally { paginationLock.current = false; if (mounted.current && expectedQuery === queryRef.current) setLoading(false); }
  }
  return <section className="pickup-card">
    <Link href={role === "admin" ? "/admin" : "/dashboard/venue"}>‹ Dashboard</Link>
    <h1>Pickup requests</h1>
    <p>Customers shared these details so the club can contact them directly. Call or email to arrange and confirm pickup.</p>
    <div className="pickup-filters">
      {venues.length > 1 && <label>Club<select disabled={loading} value={venueId} onChange={event => setVenueId(event.target.value)}><option value="">All clubs</option>{venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label>}
      <label>From date (UTC)<input disabled={loading} type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>Through date (UTC)<input disabled={loading} type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
    </div>
    <button onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh requests</button>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading pickup requests…</p>}
    {!loading && !error && !requests.length && <p>No pickup requests found.</p>}
    <div className="pickup-list">{requests.map(request => <article className="pickup-list-item" key={request.id}>
      <strong>{request.venue_name} · {request.name}</strong>
      <span>{request.party_size} {request.party_size === 1 ? "guest" : "guests"} · {request.location}</span>
      <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString()}</time>
      <a href={"tel:" + request.phone}>Call {request.phone}</a>
      <a href={"mailto:" + encodeURIComponent(request.email)}>Email {request.email}</a>
    </article>)}</div>
    {more && <button disabled={loading} onClick={() => void loadMore()}>Load more requests</button>}
  </section>;
}
