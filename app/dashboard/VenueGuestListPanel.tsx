"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { clubArrivalLabel } from "@/src/lib/dancr/club-deal-transportation";
import type { VenueGuestListEntry } from "@/src/lib/dancr/guest-list";

export default function VenueGuestListPanel({ refreshKey }: { refreshKey?: string | null }) {
  const [entries, setEntries] = useState<VenueGuestListEntry[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false), [hasMore, setHasMore] = useState(false);
  const controller = useRef<AbortController | null>(null);

  async function load(offset = 0) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
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
    void load();
    return () => controller.current?.abort();
  }, [refreshKey]);

  return <div className="venue-guest-list">
    <header className="venue-section-heading"><h2 id="venue-guest-list-heading">Guest list</h2>
      <button className="venue-utility" type="button" aria-label="Refresh guest list" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh"}</button></header>
    <p>Guests with active passes. Verify arrival and scan each pass.</p>
    {error ? <p role="alert">{error}</p> : null}
    {loaded && !entries.length ? <p>No guests on the list yet.</p> : null}
    <div className="notification-list">
      {entries.map(entry => <article className="notification-row" key={entry.id}>
        <strong>{entry.name}</strong>
        <span>{entry.status === "redeemed" ? "Admitted" : "Expected"} · {clubArrivalLabel(entry.arrivalMethod)}</span>
        <a href={`tel:${entry.phone}`}>{entry.phone}</a>
        {entry.email ? <a href={`mailto:${entry.email}`}>{entry.email}</a> : null}
        <small>Joined {new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
      </article>)}
    </div>
    {hasMore ? <button type="button" disabled={busy} onClick={() => void load(entries.length)}>Load more guests</button> : null}
  </div>;
}
