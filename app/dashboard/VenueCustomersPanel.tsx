"use client";
import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { VenueCustomer } from "@/src/lib/dancr/venue-customers";
import "./venue-customers.css";

export default function VenueCustomersPanel({ refreshKey, active }: { refreshKey: string; active: boolean }) {
  const [source, setSource] = useState("all");
  const [entries, setEntries] = useState<VenueCustomer[]>([]);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [hasMore, setHasMore] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function load(offset = 0) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    if (!offset) { setEntries([]); setLoaded(false); setHasMore(false); }
    try {
      const data = await requestDashboardJson(`/api/venue/customers?source=${source}&offset=${offset}`, {
        expectedRole: "venue", signal: request.signal, cache: "no-store", timeoutMs: 15000, fallbackMessage: "Unable to load customers.",
      });
      if (request.signal.aborted) return;
      setEntries(previous => offset ? [...new Map([...previous, ...data.entries].map(entry => [entry.id, entry])).values()] : data.entries);
      setHasMore(data.hasMore); setLoaded(true);
    } catch (reason) {
      if (request.signal.aborted) return;
      setEntries([]); setLoaded(false); setHasMore(false);
      setError(reason instanceof Error ? reason.message : "Unable to load customers.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    setEntries([]); setLoaded(false); setHasMore(false); setError("");
    if (active) void load();
    return () => controller.current?.abort();
  }, [refreshKey, source, active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    function refresh() { if (active && document.visibilityState === "visible") void load(); }
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [source, active]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="info-panel" id="venue-customers" aria-labelledby="venue-customers-heading" tabIndex={-1}>
    <header className="venue-section-heading"><h2 id="venue-customers-heading">Customers</h2>
      <button className="venue-utility" type="button" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh"}</button></header>
    <p>Followers who chose to share their details, and guests with active passes. Guest-list details are for the current visit. Sharing does not authorize marketing emails or texts.</p>
    <div className="venue-analytics-period" role="group" aria-label="Customer source">
      {[["all", "All"], ["followers", "Followers"], ["guests", "Guest list"]].map(([value, label]) =>
        <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)}>{label}</button>)}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {loaded && !entries.length ? <p className="venue-value-empty">No customers have shared details in this group yet. Private followers are counted in Results.</p> : null}
    <div className="notification-list">{entries.map(entry => <article className="notification-row" key={entry.id}>
      <strong>{entry.name}</strong><span>{entry.is_follower && entry.is_guest ? "Follower · Guest list" : entry.is_follower ? "Follower" : "Guest list"}</span>
      {entry.email ? <span>{entry.email}</span> : null}{entry.phone ? <span>{entry.phone}</span> : null}{entry.city ? <span>{entry.city}</span> : null}
      <small>Latest activity {new Date(entry.joined_at).toLocaleDateString()}</small>
    </article>)}</div>
    {hasMore ? <button type="button" disabled={busy} onClick={() => void load(entries.length)}>Load more customers</button> : null}
  </section>;
}
