"use client";
import RefreshButton from "../components/RefreshButton";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PhonePickupRequest } from "@/src/lib/dancr/pickup-domain";
import { requestPickupJson } from "../pickups/pickup-session";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import { requestDashboardJson } from "./dashboard-session";
import { RIDE_STATUSES, notifyVenueOperationsChanged, type RideStatus } from "@/src/lib/dancr/venue-operations";

export default function PickupDashboardPanel({ refreshKey, venueId, active = true, timezone }: {
  refreshKey?: string | null; venueId?: string; active?: boolean; timezone?: string;
}) {
  const [requests, setRequests] = useState<PhonePickupRequest[]>([]);
  const [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [hasMore, setHasMore] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false), olderPages = useRef(false);
  const [queue, setQueue] = useState("open"), [saving, setSaving] = useState("");
  const actionController = useRef<AbortController | null>(null);
  const currentRequests = useRef<PhonePickupRequest[]>([]);
  useEffect(() => {
    currentRequests.current = []; olderPages.current = false;
    setRequests([]); setLoaded(false); setHasMore(false); setError("");
  }, [venueId, queue]);
  const load = useCallback(async (offset = 0) => {
    if (!venueId || actionController.current) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    pending.current = true; setBusy(true); setError("");
    const previous = currentRequests.current;
    try {
      const pages = offset ? 1 : Math.max(1, Math.ceil(previous.length / 30));
      const results: PhonePickupRequest[] = [];
      let more = false;
      for (let page = 0; page < pages; page++) {
        const params = new URLSearchParams({ venueId, phoneOffset: String(offset || page * 30), rideQueue: queue });
        const data = await requestPickupJson(`/api/pickups?${params}`, { signal: request.signal, cache: "no-store" });
        if (request.signal.aborted) return;
        results.push(...data.phoneRequests.filter((entry: PhonePickupRequest) => entry.venue_id === venueId));
        more = Boolean(data.hasMorePhoneRequests);
        if (!more) break;
      }
      const next = [...new Map([...(offset ? previous : []), ...results].map(entry => [entry.id, entry])).values()];
      currentRequests.current = next; setRequests(next);
      setHasMore(more); setLoaded(true); olderPages.current = offset > 0 || pages > 1;
    } catch (reason) {
      if (request.signal.aborted) return;
      if (reason && typeof reason === "object" && "status" in reason && [401, 403].includes(Number(reason.status))) {
        currentRequests.current = []; setRequests([]); setLoaded(false); setHasMore(false); olderPages.current = false;
      }
      setError(reason instanceof Error ? reason.message : "Unable to load ride requests.");
    } finally { if (!request.signal.aborted) { pending.current = false; setBusy(false); } }
  }, [venueId, queue]);
  useEffect(() => {
    setSaving("");
    return () => { actionController.current?.abort(); actionController.current = null; };
  }, [venueId, active]);
  async function updateRide(ride: PhonePickupRequest, status: RideStatus) {
    if (actionController.current) return;
    const request = new AbortController(); actionController.current = request;
    controller.current?.abort(); pending.current = true; setSaving(ride.id); setError("");
    try {
      const result = await requestDashboardJson("/api/venue/rides", { method: "POST", expectedRole: "venue", signal: request.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ride.id, status, version: ride.staff_status_version ?? 0 }) });
      if (request.signal.aborted) return;
      const next = currentRequests.current.flatMap(row => {
        if (row.id !== ride.id) return [row];
        const updated = { ...row, ...result.ride };
        return queue === "open" && ["completed", "cancelled"].includes(updated.staff_status) || ["completed", "cancelled"].includes(queue) && updated.staff_status !== queue ? [] : [updated];
      });
      currentRequests.current = next; setRequests(next);
      notifyVenueOperationsChanged();
    } catch (reason) {
      if (!request.signal.aborted) {
        if (reason && typeof reason === "object" && "status" in reason && [401, 403].includes(Number(reason.status))) {
          currentRequests.current = []; setRequests([]); setLoaded(false); setHasMore(false); olderPages.current = false;
        }
        setError(reason instanceof Error ? reason.message : "Unable to update ride.");
      }
    }
    finally { if (actionController.current === request) { actionController.current = null; pending.current = false; setSaving(""); setBusy(false); } }
  }
  useEffect(() => {
    if (!active || !venueId) return;
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending.current && !actionController.current && !olderPages.current) void load();
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
      <RefreshButton label="Refresh ride requests" busy={busy} className="venue-utility" type="button" disabled={busy || Boolean(saving) || !venueId} onClick={() => void load()} /></header>
    <p>Contact the guest, then update the ride. Statuses are recorded by your team and do not verify club admission.</p>
    <label className="venue-ride-filter">Show rides<select value={queue} disabled={Boolean(saving)} onChange={event => setQueue(event.target.value)}><option value="open">Open · last 48 hours</option><option value="all">All requests</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
    {timezone && <p className="venue-value-note">Times shown in {timezone.replaceAll("_", " ")}.</p>}
    {error && <p role="alert">{error}</p>}
    {!loaded && !error && <p role="status">{venueId ? "Loading ride requests…" : "Loading venue…"}</p>}
    {loaded && !error && !requests.length && <p className="venue-value-empty">No rides match this view.</p>}
    <div className="notification-list">{requests.map(request => <article className="notification-row venue-guest-record" key={request.id}>
      <strong>{request.name}</strong><span className="venue-guest-status">{RIDE_STATUSES[request.staff_status || "received"]}</span>
      <div className="venue-ride-actions"><a className="primary-link" href={`tel:${request.phone}`}>Call guest</a><label>Ride status<select aria-label={`Ride status for ${request.name}`} disabled={Boolean(saving)} value={request.staff_status || "received"} onChange={event => void updateRide(request, event.target.value as RideStatus)}>{Object.entries(RIDE_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {saving === request.id && <small role="status">Saving ride status…</small>}
      <dl>
        <div><dt>Pickup location</dt><dd>{request.location}</dd></div>
        <div><dt>Passengers requested</dt><dd>{request.party_size}</dd></div>
        <div><dt>Phone</dt><dd><a href={`tel:${request.phone}`}>{request.phone}</a></dd></div>
        <div><dt>Email</dt><dd>{request.email ? <a href={`mailto:${encodeURIComponent(request.email)}`}>{request.email}</a> : "Not provided"}</dd></div>
        <div><dt>Requested</dt><dd><time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></dd></div>
      </dl>
      <small>Details shared to arrange this ride.</small>
    </article>)}</div>
    {olderPages.current && <p className="venue-value-note">Older requests loaded. Refresh updates this list.</p>}
    {hasMore && <button type="button" disabled={busy || Boolean(saving)} onClick={() => void load(requests.length)}>Load older requests</button>}
    <Link className="primary-link dashboard-primary-action" href="/pickups">Open pickup inbox →</Link>
  </div>;
}
