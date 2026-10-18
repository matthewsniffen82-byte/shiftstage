"use client";

import { useEffect, useRef, useState } from "react";
import type { DancerRequestPage, DancerRequestStatus, DancerRequestWindow } from "@/src/lib/dancr/dancer-request-types";
import { requestDashboardJson } from "./dashboard-session";

const statuses: Record<DancerRequestStatus, string> = {
  pending: "Pending", acknowledged: "Acknowledged", completed: "Marked complete by staff",
  confirmed: "Confirmed", declined: "Declined", cancelled: "Cancelled",
};
const dateTime = (value: string, timezone: string) => {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try { return date.toLocaleString("en-US", { ...options, timeZone: timezone }); }
  catch { return date.toLocaleString("en-US", { ...options, timeZone: "UTC" }); }
};

export function DancerRequestDialog({ window: range, onClose }: { window: DancerRequestWindow; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(range.pending);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<DancerRequestPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ channel: range.channel, since: range.since, until: range.until, pending: String(pending), offset: String(offset) });
    if (range.venueId) params.set("venueId", range.venueId);
    setPage(null); setError("");
    void requestDashboardJson(`/api/dancer/requests?${params}`, {
      expectedRole: "dancer", cache: "no-store", signal: controller.signal, timeoutMs: 15000,
      fallbackMessage: "Unable to load requests. Try again.",
    }).then(result => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(result.items) || (result.nextOffset !== null && (!Number.isInteger(result.nextOffset) || Number(result.nextOffset) <= offset))) throw new Error("Invalid request list.");
      setPage(result as DancerRequestPage);
    }).catch(() => { if (!controller.signal.aborted) setError("Unable to load requests. Try again."); });
    return () => controller.abort();
  }, [range.channel, range.since, range.until, range.venueId, pending, offset, retry]);

  return <dialog ref={dialogRef} className="dancer-request-dialog" aria-labelledby="dancer-request-list-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><h2 id="dancer-request-list-title">{range.channel === "internal" ? "Table requests" : "VIP requests"}</h2><button type="button" onClick={onClose} aria-label="Close requests">Close</button></header>
    <p className="dancer-request-context">{range.label}</p>
    <div className="dancer-request-filters" role="group" aria-label="Request status">
      <button type="button" aria-pressed={!pending} onClick={() => { setPending(false); setOffset(0); }}>All</button>
      <button type="button" aria-pressed={pending} onClick={() => { setPending(true); setOffset(0); }}>Pending</button>
    </div>
    <p className="dancer-request-context">Submitted during this period. Current status shown; club staff manage confirmations.</p>
    <div aria-busy={!page && !error} aria-live="polite">
      {!page && !error && <p role="status">Loading requests…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {page && <>
        {page.items.length ? <ul className="dancer-request-list">{page.items.map(item => <li key={item.id}>
          <div><strong>{item.label}</strong><span className="dancer-request-status" data-pending={item.status === "pending"}>{statuses[item.status] || "Status unavailable"}</span></div>
          <span>{item.venueName}</span>
          <small>Requested <time dateTime={item.createdAt}>{dateTime(item.createdAt, item.timezone)}</time></small>
          {item.startsAt && <small>Visit <time dateTime={item.startsAt}>{dateTime(item.startsAt, item.timezone)}</time></small>}
        </li>)}</ul> : <p>{offset > 0 ? "No requests on this page. Go back to the previous page." : `No ${pending ? "pending " : ""}requests in this period.`}</p>}
      </>}
    </div>
    <footer>
      <button type="button" disabled={offset === 0 || (!page && !error)} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous</button>
      <span>Page {Math.floor(offset / 20) + 1}</span>
      <button type="button" disabled={!page || page.nextOffset === null} onClick={() => { if (page?.nextOffset != null) setOffset(page.nextOffset); }}>Next</button>
    </footer>
  </dialog>;
}
