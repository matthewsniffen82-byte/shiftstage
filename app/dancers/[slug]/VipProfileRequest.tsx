"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DASHBOARD_SESSION_KEY, readSession, requestDashboardJson } from "@/app/dashboard/dashboard-session";
import { safeLocalReturnPath } from "@/src/lib/dancr/safe-return-path";
import { vipLocalDate, type VipState, type VipVenue } from "@/src/lib/dancr/vip-types";
import "./vip-profile-request.css";

function dashboardVenue(returnHref: string) {
  const path = safeLocalReturnPath(returnHref);
  if (!path) return "";
  const url = new URL(path, "https://mydancr.invalid");
  return url.pathname === "/vip" ? url.searchParams.get("venueId") || "" : "";
}

function signedInCustomer() {
  const session = readSession();
  return session?.accessToken && session.account?.role === "customer" ? session.account.id || "" : "";
}

export default function VipProfileRequest({ dancerId, stageName, returnHref, children }: {
  dancerId: string; stageName: string; returnHref: string; children: ReactNode;
}) {
  const venueId = dashboardVenue(returnHref);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [access, setAccess] = useState<{ accountId: string; venue: VipVenue; available: boolean } | null>(null);
  const [fallback, setFallback] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const submitAbort = useRef<AbortController | null>(null);
  const retry = useRef<{ id: string; fingerprint: string } | null>(null);
  const venue = access?.accountId === accountId && access.venue.id === venueId ? access.venue : null;
  const requestsHref = `/vip?venueId=${encodeURIComponent(venueId)}#vip-requests`;

  useEffect(() => {
    const sync = () => setAccountId(signedInCustomer());
    const changed = (event: StorageEvent) => { if (!event.key || event.key === DASHBOARD_SESSION_KEY) sync(); };
    sync();
    window.addEventListener("storage", changed);
    window.addEventListener("focus", sync);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", sync); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const dialog = dialogRef.current;
    setAccess(null); setFallback(false); setLoadError(""); setError(""); setBusy(false); setSent(false);
    setDate(""); setTime(""); retry.current = null; locked.current = false;
    if (accountId && venueId) {
      const params = new URLSearchParams({ view: "dancers", venueId });
      requestDashboardJson(`/api/vip?${params}`, {
        expectedRole: "customer", cache: "no-store", timeoutMs: 20000, signal: controller.signal,
        fallbackMessage: "Unable to check VIP access. Try again.",
      }).then((data: VipState) => {
        if (controller.signal.aborted || signedInCustomer() !== accountId) return;
        const member = data.venues.find(item => item.id === venueId);
        if (!member || data.selectedVenueId !== venueId) { setFallback(true); return; }
        setAccess({ accountId, venue: member, available: data.dancers.some(dancer => dancer.id === dancerId && dancer.canRequest === true) });
        setDate(vipLocalDate(member.timezone));
      }).catch(failure => {
        if (controller.signal.aborted || signedInCustomer() !== accountId) return;
        if (failure?.status === 401 || failure?.status === 403) setFallback(true);
        else setLoadError("Unable to check VIP access. Try again.");
      });
    }
    return () => { controller.abort(); submitAbort.current?.abort(); dialog?.close(); };
  }, [accountId, dancerId, venueId, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || sent || !venue || !access?.available) return;
    if (signedInCustomer() !== accountId) { setAccountId(signedInCustomer()); return; }
    if (!date || !time) { setError("Choose a visit date and time."); return; }
    locked.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    submitAbort.current = controller;
    const fingerprint = JSON.stringify({ accountId, venueId, dancerId, date, time });
    if (retry.current?.fingerprint !== fingerprint) retry.current = { id: crypto.randomUUID(), fingerprint };
    const requestId = retry.current.id;
    try {
      const data = await requestDashboardJson("/api/vip", {
        method: "POST", expectedRole: "customer", timeoutMs: 20000, signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, dancerIds: [dancerId], localStart: `${date}T${time}`, requestId }),
        fallbackMessage: "Unable to send your request. Try again.",
      });
      if (controller.signal.aborted || signedInCustomer() !== accountId) return;
      if (data.request?.id !== requestId || data.request.venue_id !== venueId) throw new Error("Unable to confirm your request. Try again.");
      setSent(true);
      window.location.assign(requestsHref);
    } catch (failure) {
      if (!controller.signal.aborted && signedInCustomer() === accountId) {
        setError(failure instanceof Error ? failure.message : "Unable to send your request. Try again.");
      }
    } finally {
      if (!controller.signal.aborted) { locked.current = false; setBusy(false); }
    }
  }

  if (!venueId || accountId === "" || fallback) return children;
  return <div className="profile-tonight-deal vip-profile-request">
    <button type="button" className="vip-profile-request-action primary-action" disabled={!venue || !access?.available || busy || sent}
      aria-label={`Request ${stageName}`} aria-busy={!venue && !loadError}
      onClick={() => {
        if (signedInCustomer() !== accountId) { setAccountId(signedInCustomer()); return; }
        dialogRef.current?.showModal();
      }}>
      <span>{sent ? "Requested" : "Request"}</span><span aria-hidden="true">›</span>
    </button>
    {loadError && <div role="alert" className="vip-profile-request-hint">{loadError}
      <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button>
    </div>}
    {venue && !access?.available && <p className="vip-profile-request-hint">Unavailable to request at {venue.name}.</p>}
    <dialog ref={dialogRef} className="vip-profile-request-dialog" aria-labelledby="vip-profile-request-title"
      onCancel={event => { if (locked.current) event.preventDefault(); }}
      onKeyDown={event => event.stopPropagation()}>
      <form onSubmit={submit}>
        <h2 id="vip-profile-request-title">Request {stageName}</h2>
        <p>{venue?.name}</p>
        <div className="vip-profile-request-fields">
          <label>Visit date<input type="date" required min={venue ? vipLocalDate(venue.timezone) : undefined}
            value={date} disabled={busy || sent} onChange={event => setDate(event.target.value)} /></label>
          <label>Visit time<input type="time" required value={time} disabled={busy || sent}
            onChange={event => setTime(event.target.value)} /></label>
        </div>
        <p className="vip-profile-request-hint">Club time: {venue?.timezone.replaceAll("_", " ")}. Your request needs venue confirmation.</p>
        {error && <p role="alert">{error}</p>}
        {sent ? <a href={requestsHref}>View your requests →</a> : <div className="vip-profile-request-controls">
          <button type="button" disabled={busy} onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="submit" className="vip-profile-request-action" disabled={busy || !venue || !access?.available}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>}
      </form>
    </dialog>
  </div>;
}
