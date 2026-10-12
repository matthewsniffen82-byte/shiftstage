"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PhonePickupRequest } from "@/src/lib/dancr/pickup-domain";
import { requestPickupJson } from "../pickups/pickup-session";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";

export default function PickupDashboardPanel({ refreshKey, venueId, active = true, timezone }: {
  refreshKey?: string | null; venueId?: string; active?: boolean; timezone?: string;
}) {
  const [requests, setRequests] = useState<PhonePickupRequest[]>([]);
  const [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [hasMore, setHasMore] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false), olderPages = useRef(false);
  const load = useCallback(async (offset = 0, silent = false) => {
    if (!venueId) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    pending.current = true; setBusy(true); setError("");
    if (!offset) {
      olderPages.current = false;
      if (!silent) { setRequests([]); setLoaded(false); setHasMore(false); }
    }
    try {
      const params = new URLSearchParams({ venueId, phoneOffset: String(offset) });
      const data = await requestPickupJson(`/api/pickups?${params}`, { signal: request.signal, cache: "no-store" });
      if (request.signal.aborted) return;
      const entries: PhonePickupRequest[] = data.phoneRequests.filter((entry: PhonePickupRequest) => entry.venue_id === venueId);
      setRequests(previous => offset ? [...new Map([...previous, ...entries].map(entry => [entry.id, entry])).values()] : entries);
      setHasMore(data.hasMorePhoneRequests); setLoaded(true); olderPages.current = offset > 0;
    } catch (reason) {
      if (request.signal.aborted) return;
      setRequests([]); setLoaded(false); setHasMore(false); olderPages.current = false;
      setError(reason instanceof Error ? reason.message : "Unable to load ride requests.");
    } finally { if (!request.signal.aborted) { pending.current = false; setBusy(false); } }
  }, [venueId]);
  useEffect(() => {
    if (!active || !venueId) return;
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending.current && !olderPages.current) void load(0, true);
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.current?.abort(); pending.current = false; window.clearInterval(timer);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, venueId, refreshKey, load]);
  return <div className="venue-pickup-preview">
    <header className="venue-section-heading"><h2 className="venue-icon-heading"><VenueDashboardIcon section="pickups" />Ride requests</h2>
      <button className="venue-utility" type="button" disabled={busy || !venueId} onClick={() => void load()}>{busy ? "Loading…" : "Refresh"}</button></header>
    <p>Contact guests to arrange pickup. These are submitted requests; completed pickups are not recorded here.</p>
    {timezone && <p className="venue-value-note">Times shown in {timezone.replaceAll("_", " ")}.</p>}
    {error && <p role="alert">{error}</p>}
    {!loaded && !error && <p role="status">{venueId ? "Loading ride requests…" : "Loading venue…"}</p>}
    {loaded && !error && !requests.length && <p className="venue-value-empty">No ride requests yet.</p>}
    <div className="notification-list">{requests.map(request => <article className="notification-row venue-guest-record" key={request.id}>
      <strong>{request.name}</strong><span className="venue-guest-status">Request received</span>
      <dl>
        <div><dt>Pickup location</dt><dd>{request.location}</dd></div>
        <div><dt>Passengers requested</dt><dd>{request.party_size}</dd></div>
        <div><dt>Phone</dt><dd><a href={`tel:${request.phone}`}>{request.phone}</a></dd></div>
        <div><dt>Email</dt><dd>{request.email ? <a href={`mailto:${encodeURIComponent(request.email)}`}>{request.email}</a> : "Not provided"}</dd></div>
        <div><dt>Requested</dt><dd><time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></dd></div>
      </dl>
      <small>Details shared to arrange this ride.</small>
    </article>)}</div>
    {olderPages.current && <p className="venue-value-note">Reviewing older requests. Refresh to return to the latest requests.</p>}
    {hasMore && <button type="button" disabled={busy} onClick={() => void load(requests.length)}>Load older requests</button>}
    <Link className="primary-link dashboard-primary-action" href="/pickups">Open pickup inbox →</Link>
  </div>;
}
