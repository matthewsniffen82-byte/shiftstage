"use client";
import RefreshButton from "../components/RefreshButton";
import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { VenueCustomer } from "@/src/lib/dancr/venue-customers";
import "./venue-customers.css";

export default function VenueCustomersPanel({ refreshKey, active, timezone }: { refreshKey: string; active: boolean; timezone?: string }) {
  const [source, setSource] = useState("all");
  const [input, setInput] = useState(""), [search, setSearch] = useState("");
  const [entries, setEntries] = useState<VenueCustomer[]>([]);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [hasMore, setHasMore] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const currentEntries = useRef<VenueCustomer[]>([]);
  const currentQuery = useRef("");
  async function load(offset = 0) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    const query = new URLSearchParams({ source, search });
    if (currentQuery.current !== query.toString()) {
      currentQuery.current = query.toString(); currentEntries.current = [];
      setEntries([]); setLoaded(false); setHasMore(false);
    }
    const previous = currentEntries.current;
    try {
      const pages = offset ? 1 : Math.max(1, Math.ceil(previous.length / 50));
      const results: VenueCustomer[] = [];
      let more = false;
      for (let page = 0; page < pages; page++) {
        query.set("offset", String(offset || page * 50));
        const data = await requestDashboardJson(`/api/venue/customers?${query}`, {
          expectedRole: "venue", signal: request.signal, cache: "no-store", timeoutMs: 15000, fallbackMessage: "Unable to load customers.",
        });
        if (request.signal.aborted) return;
        results.push(...data.entries); more = Boolean(data.hasMore);
        if (!more) break;
      }
      const next = [...new Map([...(offset ? previous : []), ...results].map(entry => [entry.id, entry])).values()];
      currentEntries.current = next; setEntries(next);
      setHasMore(more); setLoaded(true);
    } catch (reason) {
      if (request.signal.aborted) return;
      if (reason && typeof reason === "object" && "status" in reason && [401, 403].includes(Number(reason.status))) {
        currentEntries.current = []; setEntries([]); setLoaded(false); setHasMore(false);
      }
      setError(reason instanceof Error ? reason.message : "Unable to load customers.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    if (active) void load();
    return () => controller.current?.abort();
  }, [refreshKey, source, active, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    function refresh() { if (active && document.visibilityState === "visible") void load(); }
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [source, active, search]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="venue-contacts">
    <header className="venue-section-heading"><h2 id="venue-customers-heading">Contacts</h2>
      <RefreshButton label="Refresh customers" busy={busy} className="venue-utility" type="button" disabled={busy} onClick={() => void load()} /></header>
    <p>Search shared contacts. Email and text badges show active subscriptions to this club.</p>
    <form className="venue-search-form" role="search" onSubmit={event => { event.preventDefault(); setSearch(input.trim()); }}><label>Find a contact<input type="search" maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="Search names" /></label><button type="submit">Search</button>{(input || search) && <button type="button" onClick={() => { setInput(""); setSearch(""); }}>Clear</button>}</form>
    <div className="venue-analytics-period" role="group" aria-label="Contact source">
      {[["all", "Shared contacts"], ["followers", "Shared followers"], ["guests", "Guest list"], ["email_updates", "Email updates"], ["text_updates", "Text updates"]].map(([value, label]) =>
        <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)}>{label}</button>)}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {loaded && !entries.length ? <p className="venue-value-empty">{source.endsWith("_updates") ? "No guests have opted in to this type of update yet." : "No contacts have shared details in this group yet. Private followers are counted in Results."}</p> : null}
    <div className="notification-list">{entries.map(entry => <article className="notification-row venue-guest-record" key={entry.id}>
      <strong>{entry.name}</strong><span>{entry.is_updates ? "Club update subscriber" : entry.is_follower && entry.is_guest ? "Follower · Guest list" : entry.is_follower ? "Follower" : "Guest list"}</span>
      <div className="venue-contact-badges">{entry.email_updates_at && <span>Email updates ✓</span>}{entry.text_updates_at && <span>Text updates ✓</span>}{!entry.email_updates_at && !entry.text_updates_at && <span>{entry.is_guest && !entry.is_follower ? "Visit details only" : "No update subscriptions"}</span>}</div>
      <details><summary>Contact &amp; sharing details</summary>
      <dl>
        <div><dt>Email</dt><dd>{entry.email ? <a href={`mailto:${encodeURIComponent(entry.email)}`}>{entry.email}</a> : "Not shared"}</dd></div>
        <div><dt>Phone</dt><dd>{entry.phone ? <a href={`tel:${entry.phone}`}>{entry.phone}</a> : "Not shared"}</dd></div>
        {entry.city && <div><dt>City</dt><dd>{entry.city}</dd></div>}
        <div><dt>Shared for</dt><dd>{entry.is_updates ? "Club updates" : entry.is_follower && entry.is_guest ? "Club customer list and current guest-list visit" : entry.is_follower ? "Club customer list" : "Current guest-list visit"}</dd></div>
        {(!entry.is_updates || entry.email) && <div><dt>Email updates</dt><dd>{entry.email_updates_at ? <>Opted in · <time dateTime={entry.email_updates_at}>{new Date(entry.email_updates_at).toLocaleDateString(undefined, { timeZone: timezone })}</time></> : "No active opt-in recorded"}</dd></div>}
        {(!entry.is_updates || entry.phone) && <div><dt>Text updates</dt><dd>{entry.text_updates_at ? <>Opted in · <time dateTime={entry.text_updates_at}>{new Date(entry.text_updates_at).toLocaleDateString(undefined, { timeZone: timezone })}</time></> : "No active opt-in recorded"}</dd></div>}
      </dl>
      <small>Latest shared activity <time dateTime={entry.joined_at}>{new Date(entry.joined_at).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>{timezone ? ` (${timezone.replaceAll("_", " ")})` : ""}</small>
      </details>
    </article>)}</div>
    {hasMore ? <button type="button" disabled={busy} onClick={() => void load(entries.length)}>Load more contacts</button> : null}
  </div>;
}
