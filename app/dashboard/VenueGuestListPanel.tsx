"use client";
import RefreshButton from "../components/RefreshButton";

import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardDataRequestError, requestDashboardJson } from "./dashboard-session";
import { clubArrivalLabel } from "@/src/lib/dancr/club-deal-transportation";
import type { VenueGuestListEntry } from "@/src/lib/dancr/guest-list";
import { VenueDashboardIcon } from "./VenueDashboardIdentity";
import "./venue-guest-list.css";

type GuestStatus = "generated" | "redeemed" | "all";
type GuestPage = { entries: VenueGuestListEntry[]; hasMore: boolean; counts: Record<GuestStatus, number>; updatedAt: string; timezone: string };
const filters = [["generated", "Awaiting admission"], ["redeemed", "Admitted"], ["all", "All"]] as const;

export default function VenueGuestListPanel({ refreshKey, active = true, timezone }: { refreshKey?: string | null; active?: boolean; timezone?: string }) {
  const [entries, setEntries] = useState<VenueGuestListEntry[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false), [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<GuestPage["counts"] | null>(null);
  const [updatedAt, setUpdatedAt] = useState(""), [clubTimezone, setClubTimezone] = useState(timezone);
  const [input, setInput] = useState(""), [search, setSearch] = useState("");
  const [status, setStatus] = useState<GuestStatus>("all"), [period, setPeriod] = useState("tonight"), [date, setDate] = useState("");
  const controller = useRef<AbortController | null>(null);
  const currentEntries = useRef<VenueGuestListEntry[]>([]);
  const currentQuery = useRef("");
  const retryMore = useRef(false);
  const scrollBox = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (more = false) => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const query = new URLSearchParams({ search, status, period, ...(period === "date" ? { date } : {}) });
    const changed = currentQuery.current !== query.toString();
    if (changed) {
      currentQuery.current = query.toString(); currentEntries.current = [];
      setEntries([]); setLoaded(false); setHasMore(false); setCounts(null); setUpdatedAt("");
      if (scrollBox.current) scrollBox.current.scrollTop = 0;
    }
    setError(""); retryMore.current = more && !changed;
    if (period === "date" && !date) { setBusy(false); controller.current = null; return; }
    setBusy(true);
    const previous = currentEntries.current;
    try {
      // Refresh every loaded page so lower rows and expanded details stay mounted.
      // Only new filters reset the scroll area.
      const pages = more ? 1 : Math.max(1, Math.ceil(previous.length / 50));
      const results: VenueGuestListEntry[] = [];
      let page: GuestPage | null = null;
      for (let index = 0; index < pages; index++) {
        query.set("offset", String(more ? previous.length : index * 50));
        page = await requestDashboardJson(`/api/venue/guest-list?${query}`, {
          expectedRole: "venue", signal: request.signal, timeoutMs: 15000, cache: "no-store", fallbackMessage: "Unable to load the guest list.",
        }) as GuestPage;
        if (request.signal.aborted) return;
        results.push(...page.entries);
        if (!page.hasMore) break;
      }
      if (!page) return;
      const next = [...new Map([...(more ? previous : []), ...results].map(entry => [entry.id, entry])).values()];
      currentEntries.current = next; setEntries(next);
      setHasMore(page.hasMore); setCounts(page.counts); setUpdatedAt(page.updatedAt); setClubTimezone(page.timezone || timezone); setLoaded(true);
    } catch (reason) {
      if (request.signal.aborted) return;
      // Keep useful rows during a transient outage, but never after revoked access.
      if (reason instanceof DashboardDataRequestError && [401, 403].includes(reason.status)) {
        currentEntries.current = []; setEntries([]); setLoaded(false); setHasMore(false); setCounts(null); setUpdatedAt("");
      }
      setError(reason instanceof Error ? reason.message : "Unable to load the guest list.");
    } finally {
      if (!request.signal.aborted) { setBusy(false); controller.current = null; }
    }
  }, [search, status, period, date, timezone]);

  useEffect(() => {
    if (active) void load();
    return () => controller.current?.abort();
  }, [refreshKey, active, load]);

  const formatTime = (value: string) => new Date(value).toLocaleString(undefined, {
    timeZone: clubTimezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const clearFilters = () => { setInput(""); setSearch(""); setStatus("all"); };
  const expiredCount = counts ? counts.all - counts.generated - counts.redeemed : 0;
  const empty = search ? "No guests match your search." : status === "generated" ? "No guests awaiting admission."
    : status === "redeemed" ? "No admissions recorded for this view." : period === "tonight" ? "No guests tonight."
      : period === "date" ? "No guests for this date." : "No active passes.";

  return <div className="venue-guest-list">
    <header className="venue-section-heading venue-guest-heading">
      <h2 className="venue-icon-heading" id="venue-guest-list-heading"><VenueDashboardIcon section="guests" />Guest list
        <span className="venue-guest-count" aria-label={counts ? `${counts[status]} guests in this view` : "Guest count loading"}>{counts ? counts[status].toLocaleString() : "—"}</span>
      </h2>
      <RefreshButton label="Refresh guest list" busy={busy} className="venue-guest-refresh" type="button" disabled={busy} onClick={() => void load()} />
    </header>
    <div className="venue-guest-toolbar">
      <div className="venue-guest-date-controls">
        <label>Visit date<select aria-label="Guest-list date" value={period} onChange={event => setPeriod(event.target.value)}>
          <option value="tonight">Tonight</option><option value="date">Choose a date</option><option value="active">All active passes</option>
        </select></label>
        {period === "date" && <label>Date<input type="date" aria-label="Visit date" value={date} onChange={event => setDate(event.target.value)} /></label>}
      </div>
      <form className="venue-search-form" role="search" aria-label="Find a guest" onSubmit={event => { event.preventDefault(); setSearch(input.trim()); }}>
        <label>Find a guest<input type="search" maxLength={100} value={input} onChange={event => { setInput(event.target.value); if (!event.target.value) setSearch(""); }} placeholder="Name, phone or email" /></label>
        <button type="submit">Search</button>
        {(search || input) && <button type="button" onClick={() => { setInput(""); setSearch(""); }}>Clear</button>}
      </form>
      <div className="venue-guest-filters" role="group" aria-label="Admission status">
        {filters.map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
          <span>{label}</span><span className="venue-guest-count">{counts ? counts[value].toLocaleString() : "—"}</span>
        </button>)}
      </div>
      <p className="venue-guest-meta">{clubTimezone ? `Club time · ${clubTimezone.replaceAll("_", " ")}` : "Club time"}
        <span role="status">{busy && loaded ? "Updating…" : updatedAt ? <>Updated <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleTimeString(undefined, { timeZone: clubTimezone, hour: "numeric", minute: "2-digit" })}</time></> : ""}</span>
      </p>
      {expiredCount > 0 && <p className="venue-guest-meta">All includes {expiredCount.toLocaleString()} expired {expiredCount === 1 ? "pass" : "passes"}.</p>}
    </div>
    {error && <div className="venue-guest-error"><p role="alert">{loaded ? `Couldn't update. Showing the last loaded list. ${error}` : error}</p><button type="button" disabled={busy} onClick={() => void load(retryMore.current)}>Retry</button></div>}
    <div className="venue-guest-scroll" role="region" aria-labelledby="venue-guest-list-heading" tabIndex={0} ref={scrollBox}>
      {!loaded && !error && busy && <p role="status" className="venue-guest-empty">Loading guest list…</p>}
      {period === "date" && !date && <p className="venue-guest-empty">Choose a date to see its guest list.</p>}
      {loaded && !entries.length && <div className="venue-guest-empty"><p>{empty}</p>{(search || status !== "all") && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>}
      {entries.map(entry => <details className="venue-guest-record" key={entry.id}>
        <summary>
          <span className="venue-guest-person"><strong>{entry.name}</strong><small>{clubArrivalLabel(entry.arrivalMethod)}</small></span>
          <span className={`venue-guest-status${entry.status === "redeemed" ? " is-admitted" : entry.status === "expired" ? " is-expired" : ""}`}>{entry.status === "redeemed" ? "Admitted" : entry.status === "expired" ? "Expired" : "Awaiting admission"}</span>
          <svg className="venue-guest-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </summary>
        <dl>
          <div><dt>Phone</dt><dd><a href={`tel:${entry.phone}`}>{entry.phone}</a></dd></div>
          <div><dt>Email</dt><dd>{entry.email ? <a href={`mailto:${encodeURIComponent(entry.email)}`}>{entry.email}</a> : "Not provided"}</dd></div>
          <div><dt>Joined guest list</dt><dd><time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time></dd></div>
          <div><dt>Pass valid until</dt><dd><time dateTime={entry.expiresAt}>{formatTime(entry.expiresAt)}</time></dd></div>
          {entry.status === "redeemed" && <div><dt>Admission recorded</dt><dd>{entry.redeemedAt ? <time dateTime={entry.redeemedAt}>{formatTime(entry.redeemedAt)}</time> : "Time unavailable"}</dd></div>}
        </dl>
      </details>)}
      {hasMore && <button className="venue-guest-more" type="button" disabled={busy} onClick={() => void load(true)}>Load more guests</button>}
    </div>
  </div>;
}
