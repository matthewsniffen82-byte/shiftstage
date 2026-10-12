"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { clubArrivalLabel } from "@/src/lib/dancr/club-deal-transportation";
import type { VenueGuestListEntry } from "@/src/lib/dancr/guest-list";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import VenuePassScanner from "./VenuePassScanner";

export default function VenueGuestListPanel({ refreshKey, active = true, timezone }: { refreshKey?: string | null; active?: boolean; timezone?: string }) {
  const [entries, setEntries] = useState<VenueGuestListEntry[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false), [hasMore, setHasMore] = useState(false);
  const [input, setInput] = useState(""), [search, setSearch] = useState("");
  const [status, setStatus] = useState("all"), [period, setPeriod] = useState("active");
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (offset = 0) => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    if (!offset) { setEntries([]); setLoaded(false); setHasMore(false); }
    try {
      const params = new URLSearchParams({ offset: String(offset), search, status, period });
      const data = await requestDashboardJson(`/api/venue/guest-list?${params}`, {
        expectedRole: "venue", signal: request.signal, timeoutMs: 15000, cache: "no-store", fallbackMessage: "Unable to load the guest list.",
      });
      if (request.signal.aborted) return;
      setEntries(previous => offset ? [...new Map([...previous, ...data.entries].map(entry => [entry.id, entry])).values()] : data.entries);
      setHasMore(data.hasMore); setLoaded(true);
    } catch (reason) {
      if (request.signal.aborted) return;
      // Do not retain private guest details after a failed authorization check.
      setEntries([]); setLoaded(false); setHasMore(false);
      setError(reason instanceof Error ? reason.message : "Unable to load the guest list.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }, [search, status, period]);

  useEffect(() => {
    if (active) void load();
    return () => controller.current?.abort();
  }, [refreshKey, active, load]);

  const formatTime = (value: string) => new Date(value).toLocaleString(undefined, {
    timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return <div className="venue-guest-list">
    <header className="venue-section-heading"><h2 className="venue-icon-heading" id="venue-guest-list-heading"><VenueDashboardIcon section="guests" />Guest list</h2>
      <button className="venue-utility" type="button" aria-label="Refresh guest list" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh"}</button></header>
    <p>Each pass admits one guest. Scan their pass when they arrive, then verify entry requirements.</p>
    <VenuePassScanner active={active} />
    <form className="venue-search-form" role="search" onSubmit={event => { event.preventDefault(); setSearch(input.trim()); }}>
      <label>Find a guest<input type="search" maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="Name, phone or email" /></label><button type="submit">Search</button>
      {(search || input) && <button type="button" onClick={() => { setInput(""); setSearch(""); }}>Clear</button>}
    </form>
    <div className="venue-list-filters"><label>Pass status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All active passes</option><option value="generated">Awaiting admission</option><option value="redeemed">Verified admission</option></select></label>
      <label>Added<select value={period} onChange={event => setPeriod(event.target.value)}><option value="active">Any time</option><option value="today">Today · club time</option></select></label></div>
    {timezone && <p className="venue-value-note">Times shown in {timezone.replaceAll("_", " ")}.</p>}
    {error ? <p role="alert">{error}</p> : null}
    {!loaded && !error && busy ? <p role="status">Loading guest list…</p> : null}
    {loaded && !entries.length ? <p className="venue-value-empty">{search || status !== "all" || period !== "active" ? "No guests match these filters." : "No guests on the list yet."}</p> : null}
    <div className="notification-list">
      {entries.map(entry => <article className="notification-row venue-guest-record" key={entry.id}>
        <strong>{entry.name}</strong>
        <small>1 guest · 1 pass</small>
        <span className={`venue-guest-status${entry.status === "redeemed" ? " is-admitted" : ""}`}>{entry.status === "redeemed" ? "Verified admission" : "Awaiting admission"}</span>
        <dl>
          <div><dt>Phone</dt><dd><a href={`tel:${entry.phone}`}>{entry.phone}</a></dd></div>
          <div><dt>Email</dt><dd>{entry.email ? <a href={`mailto:${encodeURIComponent(entry.email)}`}>{entry.email}</a> : "Not provided"}</dd></div>
          <div><dt>Arrival</dt><dd>{clubArrivalLabel(entry.arrivalMethod)}</dd></div>
          <div><dt>Joined guest list</dt><dd><time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time></dd></div>
          <div><dt>Pass valid until</dt><dd><time dateTime={entry.expiresAt}>{formatTime(entry.expiresAt)}</time></dd></div>
          {entry.status === "redeemed" && <div><dt>Admission recorded</dt><dd>{entry.redeemedAt ? <time dateTime={entry.redeemedAt}>{formatTime(entry.redeemedAt)}</time> : "Time unavailable"}</dd></div>}
        </dl>
      </article>)}
    </div>
    {hasMore ? <button type="button" disabled={busy} onClick={() => void load(entries.length)}>Load more guests</button> : null}
  </div>;
}
