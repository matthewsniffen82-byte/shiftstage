"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { clubArrivalLabel } from "@/src/lib/dancr/club-deal-transportation";
import type { VenueGuestListEntry } from "@/src/lib/dancr/guest-list";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";

export default function VenueGuestListPanel({ refreshKey, active = true, timezone }: { refreshKey?: string | null; active?: boolean; timezone?: string }) {
  const [entries, setEntries] = useState<VenueGuestListEntry[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false), [hasMore, setHasMore] = useState(false);
  const controller = useRef<AbortController | null>(null);

  async function load(offset = 0) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    if (!offset) { setEntries([]); setLoaded(false); setHasMore(false); }
    try {
      const data = await requestDashboardJson(`/api/venue/guest-list?offset=${offset}`, {
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
  }

  useEffect(() => {
    if (active) void load();
    return () => controller.current?.abort();
  }, [refreshKey, active]);

  const formatTime = (value: string) => new Date(value).toLocaleString(undefined, {
    timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return <div className="venue-guest-list">
    <header className="venue-section-heading"><h2 className="venue-icon-heading" id="venue-guest-list-heading"><VenueDashboardIcon section="guests" />Guest list</h2>
      <button className="venue-utility" type="button" aria-label="Refresh guest list" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh"}</button></header>
    <p>Guests with active passes. Details were shared for this visit. Scan each pass to verify admission.</p>
    {timezone && <p className="venue-value-note">Times shown in {timezone.replaceAll("_", " ")}.</p>}
    {error ? <p role="alert">{error}</p> : null}
    {!loaded && !error && busy ? <p role="status">Loading guest list…</p> : null}
    {loaded && !entries.length ? <p className="venue-value-empty">No guests on the list yet.</p> : null}
    <div className="notification-list">
      {entries.map(entry => <article className="notification-row venue-guest-record" key={entry.id}>
        <strong>{entry.name}</strong>
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
