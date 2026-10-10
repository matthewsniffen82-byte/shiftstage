"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import VenueAdminUtilities from "../dashboard/VenueAdminUtilities";
import { InternalRequestPushSettings } from "./InternalRequestPushSettings";
import { InternalFullProfile, type InternalProfile as Profile, type InternalRequestAction } from "./InternalFullProfile";
import { BROWSER_AUTH_SESSION_KEY, isCurrentBrowserSession, persistRefreshedBrowserAuthSession, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { ACCESS_TERMS_HREF, TABLE_REQUEST_NOTICE } from "@/src/lib/dancr/access-terms";

type Dancer = { id: string; stageName: string; workingUntil: string; avatarRevision: string; mainPhotoId: string | null; mainPhotoRevision: string; requestStatus?: "pending" | "acknowledged" | null; requestId?: string | null };
type ClubLink = { id: string; kind: "table"; label: string; token: string };
type ClubRequest = { id: string; link_id: string; dancer_id: string; status: "pending" | "acknowledged"; created_at: string };
type Snapshot = { venueName: string; venueLogoUrl?: string | null; dancers: Dancer[]; kind?: "table"; label?: string; role?: string; links?: ClubLink[]; requests?: ClubRequest[]; receipt?: { status: string } | null };

const ROSTER_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
const REQUEST_SENT_NOTICE = "Request sent to club staff. Staff acknowledgement does not guarantee the dancer is available.";
const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "Pending staff acknowledgment",
  acknowledged: "Request seen by staff",
  completed: "Request completed",
  cancelled: "Request cancelled",
  expired: "Request expired",
};
class RosterAccessError extends Error {}

async function rosterFetch(url: string, token: string | undefined, body?: Record<string, unknown>, signal?: AbortSignal) {
  const session = token ? null : readBrowserAuthSession();
  if (!token && (!session?.accessToken || session.account?.role !== "venue")) throw new RosterAccessError("Sign in with your MyDancr club account to open the internal roster.");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
  if (session?.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  let rejectAborted: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  // Bound both the request and response body so a stalled connection cannot stop polling.
  const timer = setTimeout(() => controller.abort(new Error("The request timed out. Please try again.")), 15000);
  const request = async () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    const response = await fetch(url, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers, signal: controller.signal, cache: "no-store", credentials: "same-origin" });
    const data = await response.json().catch(() => null);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (session && !isCurrentBrowserSession(session)) throw new RosterAccessError("Your account session changed. Refresh this page.");
    if (!response.ok || !data?.ok) {
      const Failure = [401, 403, 404, 410].includes(response.status) ? RosterAccessError : Error;
      throw new Failure(data?.error || "The club roster is temporarily unavailable. Please try again.");
    }
    if (session) persistRefreshedBrowserAuthSession(data.session, session);
    return data;
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}

function ProtectedMedia({ id, kind, token, alt, className, revision, priority = false, lazy = false }: { id: string; kind: "avatar" | "photo" | "video"; token?: string; alt: string; className?: string; revision?: string; priority?: boolean; lazy?: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (token) return; // Native images can stream and decode without waiting for a Blob.
    let objectUrl = "";
    const controller = new AbortController();
    const session = token ? null : readBrowserAuthSession();
    const headers: Record<string, string> = {};
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
    if (session?.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
    void fetch(`/api/internal/${kind}/${id}${kind === "video" ? "" : "?width=320"}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.blob(); })
      .then(blob => { if (controller.signal.aborted || (session && !isCurrentBrowserSession(session))) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (!controller.signal.aborted) setUrl(""); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, kind, token, revision]);
  const mediaUrl = token ? `/api/internal/${kind}/${id}?token=${encodeURIComponent(token)}&revision=${encodeURIComponent(revision || "")}${kind === "video" ? "" : "&width=320"}` : url;
  return mediaUrl ? kind === "video" ? <video src={mediaUrl} controls playsInline preload="metadata" aria-label={alt} /> : <img className={className} src={mediaUrl} alt={alt} decoding="async" loading={lazy ? "lazy" : "eager"} fetchPriority={priority ? "high" : "auto"} /> : <span className={className} aria-label="Media loading">…</span>;
}

function VenueBrandLogo({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <h1 className="ir-venue-identity">{failed ? name : <img className="ir-venue-logo" src={url} alt={name} width={208} height={76} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</h1>;
}

export function InternalRoster({ token, operationsOnly = false, roster }: { token?: string; operationsOnly?: boolean; roster?: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const refreshNow = useRef<(manual?: boolean) => void>(() => {});
  const [busy, setBusy] = useState(false);
  const [requestingDancers, setRequestingDancers] = useState<string[]>([]);
  const [confirmedDancers, setConfirmedDancers] = useState<string[]>([]);
  const confirmationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [label, setLabel] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openingProfileId, setOpeningProfileId] = useState("");
  const selectedProfile = useRef("");
  const requestKey = useRef("");
  const requestsInFlight = useRef(new Set<string>());
  const mutationInFlight = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const refreshGeneration = useRef(0);
  const fullRefreshSequence = useRef(0);
  const alive = useRef(false);
  const openedRequestInbox = useRef(false);
  const hasSnapshot = useRef(false);
  const restoredProfile = useRef(false);
  const base = token ? `/api/internal/link/${encodeURIComponent(token)}` : "/api/internal";

  const clearRoster = useCallback((message = "") => {
    hasSnapshot.current = false;
    setSnapshot(null); setProfile(null); setOpeningProfileId(""); selectedProfile.current = ""; setError(message);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal, requestsOnly = false) => {
    const generation = refreshGeneration.current;
    const sequence = requestsOnly ? fullRefreshSequence.current : ++fullRefreshSequence.current;
    const current = () => alive.current && !signal?.aborted && generation === refreshGeneration.current && sequence === fullRefreshSequence.current;
    try {
      const data = await rosterFetch(requestsOnly ? "/api/internal/requests" : `${base}${token && requestKey.current ? `?requestKey=${requestKey.current}` : ""}`, token, undefined, signal);
      if (!current()) return;
      if (requestsOnly) { setSnapshot(current => current ? { ...current, requests: data.requests } : current); return; }
      hasSnapshot.current = true;
      setSnapshot(data); setError("");
      if (token && !restoredProfile.current) {
        restoredProfile.current = true;
        const url = new URL(window.location.href);
        const requested = url.searchParams.get("profile");
        if (requested) {
          url.searchParams.delete("profile");
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
          if (data.dancers.some((dancer: Dancer) => dancer.id === requested)) selectedProfile.current = requested;
        }
      }
      const selected = selectedProfile.current;
      if (selected) {
        if (!data.dancers.some((dancer: Dancer) => dancer.id === selected)) { selectedProfile.current = ""; setProfile(null); setOpeningProfileId(""); }
        else {
          const result = await rosterFetch(`/api/internal/profile/${selected}${token ? `?token=${encodeURIComponent(token)}` : ""}`, token, undefined, signal);
          if (current() && selectedProfile.current === selected) setProfile(result.profile);
        }
      }
      return true;
    } catch (reason) {
      if (!current()) return;
      // Keep a loaded roster steady through temporary connection failures. Confirmed
      // loss of access still clears protected content, as does changing accounts.
      if (reason instanceof RosterAccessError || !hasSnapshot.current) {
        clearRoster(reason instanceof Error ? reason.message : "Unable to load roster.");
      }
      return false;
    }
  }, [base, token, clearRoster]);

  useEffect(() => {
    alive.current = true;
    const timers = confirmationTimers.current;
    clearRoster();
    let controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let nextFullRefresh = 0;
    let inFlight = false;
    let manualFeedback = false;
    let lastReturnRefresh = -Infinity;
    const poll = async (signal: AbortSignal, full = false, manual = false) => {
      if (full && token) setRefreshing(true);
      if (manual) { manualFeedback = true; setRefreshMessage(""); }
      // Focus, visibility and repeated taps can arrive together. Share one read.
      if (inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      const requestsOnly = !full && !token && hasSnapshot.current && Date.now() < nextFullRefresh;
      const updated = await refresh(signal, requestsOnly);
      if (signal.aborted) return;
      inFlight = false;
      setRefreshing(false);
      if (manualFeedback && hasSnapshot.current) setRefreshMessage(updated === true ? "Roster updated." : updated === false ? "Couldn’t refresh. Your last roster is still shown. Try again." : "");
      else if (updated === true) setRefreshMessage("");
      manualFeedback = false;
      if (!requestsOnly) nextFullRefresh = Date.now() + ROSTER_REFRESH_INTERVAL_MS;
      timer = setTimeout(() => void poll(signal), token ? ROSTER_REFRESH_INTERVAL_MS : 10000);
    };
    refreshNow.current = (manual = false) => { void poll(controller.signal, true, manual); };
    const returned = () => {
      if (!token || document.visibilityState === "hidden" || Date.now() - lastReturnRefresh < 1000) return;
      lastReturnRefresh = Date.now();
      refreshNow.current();
    };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) returned(); };
    void poll(controller.signal);
    const sessionChanged = (event: StorageEvent) => {
      if (token || (event.key !== null && event.key !== BROWSER_AUTH_SESSION_KEY)) return;
      controller.abort(); clearTimeout(timer);
      controller = new AbortController();
      inFlight = false;
      clearRoster();
      void poll(controller.signal);
    };
    window.addEventListener("storage", sessionChanged);
    if (token) {
      document.addEventListener("visibilitychange", returned);
      window.addEventListener("focus", returned);
      window.addEventListener("pageshow", restored);
    }
    return () => {
      alive.current = false; refreshNow.current = () => {};
      timers.forEach(clearTimeout); timers.clear(); controller.abort(); clearTimeout(timer);
      window.removeEventListener("storage", sessionChanged);
      document.removeEventListener("visibilitychange", returned);
      window.removeEventListener("focus", returned);
      window.removeEventListener("pageshow", restored);
    };
  }, [refresh, token, clearRoster]);

  useEffect(() => {
    if (token || !snapshot) return;
    let frame = 0;
    const openInbox = () => {
      if (openedRequestInbox.current || window.location.hash !== "#table-requests") return;
      frame = window.requestAnimationFrame(() => {
        const inbox = document.getElementById("table-requests");
        if (!inbox) return;
        openedRequestInbox.current = true;
        // The club dashboard nests this inbox inside a collapsed roster section.
        for (let parent = inbox.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        inbox.scrollIntoView({ block: "start" });
        inbox.focus({ preventScroll: true });
      });
    };
    const hashChanged = () => { openedRequestInbox.current = false; openInbox(); };
    openInbox();
    window.addEventListener("hashchange", hashChanged);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", hashChanged); };
  }, [snapshot, token]);

  async function mutate(body: Record<string, unknown>) {
    const dancerId = token && typeof body.dancerId === "string" ? body.dancerId : "";
    if (dancerId) {
      // Lock only this dancer, including rapid clicks from their full profile.
      if (requestsInFlight.current.has(dancerId)) return;
      requestsInFlight.current.add(dancerId);
      setRequestingDancers(current => [...current, dancerId]);
    } else {
      if (mutationInFlight.current) return;
      mutationInFlight.current = true;
      setBusy(true);
    }
    setNotice("");
    try {
      const result = await rosterFetch(base, token, body);
      if (!alive.current) return;
      // An older background read must not overwrite a confirmed request.
      refreshGeneration.current += 1;
      if (token && typeof body.dancerId === "string" && result.receipt) {
        requestKeys.current.delete(body.dancerId);
        const status = ["pending", "acknowledged"].includes(result.receipt.status) ? result.receipt.status : null;
        const requestId = status ? result.receipt.id : null;
        clearTimeout(confirmationTimers.current.get(dancerId));
        if (status && body.action !== "cancel_request") {
          setConfirmedDancers(current => [...current.filter(id => id !== dancerId), dancerId]);
          confirmationTimers.current.set(dancerId, setTimeout(() => {
            confirmationTimers.current.delete(dancerId);
            if (alive.current) setConfirmedDancers(current => current.filter(id => id !== dancerId));
          }, 1500));
        } else setConfirmedDancers(current => current.filter(id => id !== dancerId));
        setSnapshot(current => current ? { ...current, receipt: result.receipt, dancers: current.dancers.map(dancer => dancer.id === body.dancerId ? { ...dancer, requestStatus: status, requestId } : dancer) } : current);
        setProfile(current => current && current.id === body.dancerId ? { ...current, requestStatus: status, requestId } : current);
      }
      setNotice(token ? body.action === "cancel_request" ? "Request cancelled." : REQUEST_SENT_NOTICE : "Saved.");
      setLabel("");
      // The receipt already confirms the guest's request; refresh details quietly.
      if (dancerId) void refresh();
      else await refresh();
    } catch (reason) {
      if (alive.current) {
        if (reason instanceof RosterAccessError) clearRoster(reason.message);
        else {
          setNotice(reason instanceof Error ? reason.message : "Unable to save.");
          if (body.action === "cancel_request") void refresh();
        }
      }
    }
    finally {
      if (dancerId) {
        requestsInFlight.current.delete(dancerId);
        if (alive.current) setRequestingDancers(current => current.filter(id => id !== dancerId));
      } else {
        mutationInFlight.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }

  function requestDancer(dancerId: string) {
    if (!token || requestsInFlight.current.has(dancerId) || snapshot?.dancers.find(dancer => dancer.id === dancerId)?.requestStatus
      || (profile?.id === dancerId && profile.requestStatus)) return;
    if (!requestKeys.current.has(dancerId)) requestKeys.current.set(dancerId, crypto.randomUUID());
    requestKey.current = requestKeys.current.get(dancerId)!;
    void mutate({ dancerId, requestKey: requestKey.current });
  }

  function cancelDancer(dancerId: string, requestId?: string | null) {
    if (!token || !requestId || requestsInFlight.current.has(dancerId) || confirmedDancers.includes(dancerId)) return;
    void mutate({ action: "cancel_request", dancerId, requestId });
  }

  async function openProfile(dancer: Dancer) {
    setNotice("");
    setProfile(null); setOpeningProfileId(dancer.id);
    selectedProfile.current = dancer.id;
    const generation = refreshGeneration.current;
    try {
      const data = await rosterFetch(`/api/internal/profile/${dancer.id}${token ? `?token=${encodeURIComponent(token)}` : ""}`, token);
      if (alive.current && selectedProfile.current === dancer.id) {
        if (generation === refreshGeneration.current) setProfile(data.profile);
        else void refresh();
      }
    } catch (reason) {
      if (alive.current && selectedProfile.current === dancer.id) {
        selectedProfile.current = ""; setProfile(null); setOpeningProfileId("");
        if (reason instanceof RosterAccessError) clearRoster(reason.message);
        else setNotice(reason instanceof Error ? reason.message : "Profile unavailable.");
      }
    }
  }

  const staff = !token;
  const dancers = snapshot?.dancers || [];
  // Table snapshots already carry each dancer's active request, including after reload.
  // A receipt alone has no dancer identity; never assign it to an unrelated card.
  const tableRequests = staff ? [] : dancers.filter(dancer => dancer.requestStatus);
  const receiptStatus = snapshot?.receipt?.status;
  const inactiveReceipt = !!receiptStatus && ["completed", "cancelled", "expired"].includes(receiptStatus);
  // A hard reload has no verified venue identity yet. Keep it quiet until the
  // first response instead of flashing generic club/table names or zero counts.
  if (!staff && !snapshot && !error) return <div className="ir-shell ir-guest" aria-busy={true} data-global-navigation-swipe="ignore">
    <span className="ir-loading-status" role="status">Loading club roster</span>
    <div className="ir-loading-placeholder" aria-hidden="true">
      <div className="ir-loading-header" />
      <div className="ir-loading-grid"><span /><span /><span /></div>
    </div>
  </div>;
  return <div className={`ir-shell${staff ? " ir-staff" : " ir-guest"}${operationsOnly ? " ir-embedded" : ""}`} data-global-navigation-swipe="ignore">
    {staff && !operationsOnly ? <VenueAdminUtilities /> : null}
    {!operationsOnly && (staff || snapshot) ? <header className="ir-header"><div>
      <a className="ir-brand" href={staff ? "/dashboard/venue" : "#"}><span className="mydancr-live-logo">mydanc<span className="violet-r">r</span></span>{staff ? <span>INTERNAL</span> : null}</a>
      {!staff && snapshot?.venueLogoUrl ? <VenueBrandLogo key={snapshot.venueLogoUrl} url={snapshot.venueLogoUrl} name={snapshot.venueName} /> : <h1 className={staff ? undefined : "ir-venue-identity"}>{snapshot?.venueName || "Club roster"}</h1>}
      <p>{staff ? "Your floor. Your team. One live roster." : snapshot?.label || "Welcome to the club"}</p>
    </div>{staff ? <a className="ir-secondary" href="/dashboard/venue">Club dashboard</a> : null}</header> : null}
    {error ? <section className="ir-panel" role="alert"><h2>Roster unavailable</h2><p>{error}</p>{staff ? <a className="ir-button" data-sign-in-action href="/account?role=venue&mode=login&return_to=%2Finternal">Sign in to MyDancr</a> : null}<button onClick={() => void refresh()}>Try again</button></section> : !snapshot ? <p role="status">Loading the live roster…</p> : null}
    {notice ? <p className={`ir-notice${!staff && notice === REQUEST_SENT_NOTICE ? " ir-request-notice" : ""}`} role="status">{!staff && notice === REQUEST_SENT_NOTICE ? <><strong>Request sent to club staff.</strong><span>Staff acknowledgment does not guarantee dancer availability.</span></> : notice}</p> : null}
    {snapshot ? <>
      {!staff ? <details className="ir-terms"><summary>View terms</summary><div>
        <p>{TABLE_REQUEST_NOTICE}</p>
        <p>Other guests using this table link can see and cancel its open requests. For adults 18 and older; club admission rules still apply.</p>
        <p><a href={ACCESS_TERMS_HREF} target="_blank" rel="noreferrer">VIP &amp; Table Access Terms</a><span aria-hidden="true"> · </span><a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></p>
      </div></details> : null}
      {!operationsOnly ? <section className="ir-roster-section" aria-label={staff ? "Live internal roster" : "Available dancers"}>
        <div className="ir-section-title">
          <h2>On the floor</h2>
          <div className="ir-roster-controls">
            <span className="ir-live">● {snapshot.dancers.length} {staff ? "checked in" : "available"}</span>
            {!staff ? <button type="button" className="ir-roster-refresh" aria-label="Refresh dancers and requests" title="Refresh dancers and requests" aria-busy={refreshing} disabled={refreshing} onClick={() => refreshNow.current(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.8L21 8" /><path d="M21 3v5h-5" />
              </svg>
            </button> : null}
          </div>
        </div>
        {!staff ? <p className="ir-roster-scope-note">Only participating MyDancr dancers are shown. Additional dancers may be working at the club.</p> : null}
        {!staff && refreshMessage ? <p className="ir-refresh-message" data-error={refreshMessage !== "Roster updated." || undefined} role="status">{refreshMessage}</p> : null}
        {dancers.length ? <div className="ir-grid ir-directory-grid">{dancers.map((dancer, index) => <article className={`ir-dancer${snapshot.kind === "table" ? " ir-dancer-requestable" : ""}`} key={dancer.id} data-request-state={!staff ? dancer.requestStatus || undefined : undefined}>
          <button type="button" className="ir-profile-link" aria-label={`View ${dancer.stageName}’s full profile`} aria-busy={openingProfileId === dancer.id} onClick={() => void openProfile(dancer)}>
            {dancer.mainPhotoId ? <ProtectedMedia key={dancer.mainPhotoId} id={dancer.mainPhotoId} revision={dancer.mainPhotoRevision} kind="photo" token={token} priority={index < 3} lazy={index >= 9} className="ir-main-photo" alt={`${dancer.stageName}’s main photo`} /> : <span className="ir-main-photo ir-photo-placeholder">Photo unavailable</span>}
            {!staff && dancer.requestStatus ? <span className="ir-card-request-state">{dancer.requestStatus === "acknowledged" ? "Seen by staff" : "Requested ✓"}</span> : null}
            <span className="ir-dancer-copy"><strong>{dancer.stageName}</strong><span>{openingProfileId === dancer.id ? "Opening…" : "View profile ↗"}</span></span>
          </button>
          {snapshot.kind === "table" ? <button type="button" className="ir-table-request"
            data-request-sent={dancer.requestStatus ? "" : undefined}
            aria-label={confirmedDancers.includes(dancer.id) ? `Request sent for ${dancer.stageName}` : dancer.requestStatus ? `Cancel request for ${dancer.stageName}` : `Request ${dancer.stageName} at our table`}
            aria-busy={requestingDancers.includes(dancer.id)}
            disabled={requestingDancers.includes(dancer.id) || confirmedDancers.includes(dancer.id) || Boolean(dancer.requestStatus && !dancer.requestId)}
            onClick={() => dancer.requestStatus ? cancelDancer(dancer.id, dancer.requestId) : requestDancer(dancer.id)}>
            {requestingDancers.includes(dancer.id) ? dancer.requestStatus ? "Cancelling…" : "Sending…" : confirmedDancers.includes(dancer.id) ? <span className="internal-request-sent-label">Request sent</span> : dancer.requestStatus ? "Cancel request" : "Request"}
          </button> : null}
        </article>)}</div> : <div className="ir-empty"><h3>{staff ? "The floor is getting ready" : "No dancers are currently listed in this MyDancr roster."}</h3><p>{staff ? "Dancers appear here after choosing Internal or Both at the dressing-room NFC sticker." : "Please check back shortly or ask club staff."}</p></div>}
      </section> : null}

      {!staff && (tableRequests.length > 0 || receiptStatus) ? <section className={`ir-table-status${!tableRequests.length && inactiveReceipt ? " is-inactive" : ""}`} aria-label="Table request status" role="status">
        {tableRequests.length ? <>
          <ul>{tableRequests.map(dancer => <li key={dancer.id}>
            <strong>{dancer.stageName} requested · {snapshot.label || "Your table"}</strong>
            <span>{REQUEST_STATUS_LABELS[dancer.requestStatus!]}</span>
          </li>)}</ul>
          <p>Availability is not guaranteed.</p>
        </> : <>
          <strong>{REQUEST_STATUS_LABELS[receiptStatus!] || "Request status updated"} · {snapshot.label || "Your table"}</strong>
          {!inactiveReceipt ? <p>Availability is not guaranteed.</p> : null}
        </>}
      </section> : null}
      {staff && snapshot.receipt ? <p className="ir-notice" role="status">Your request: <strong>{snapshot.receipt.status === "acknowledged" ? "Seen by club staff" : snapshot.receipt.status}</strong></p> : null}
    </> : null}
      {staff ? <div className="ir-operations">{snapshot ? <><section className="ir-panel" id="table-requests" tabIndex={-1}><h2><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v13H9l-5 4ZM8 8h8M8 12h5" /></svg>Table requests <span>{snapshot.requests?.length || 0}</span></h2><p>“Seen” confirms staff saw the request. Coordinate availability with the dancer.</p>
        {snapshot.requests?.length ? snapshot.requests.map(item => <article className="ir-request" key={item.id}><div><strong>{snapshot.links?.find(link => link.id === item.link_id)?.label || "Table"} → {snapshot.dancers.find(d => d.id === item.dancer_id)?.stageName}</strong><small>{item.status === "pending" ? "New request" : "Seen by staff"} · {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div><div className="ir-actions"><button disabled={busy} onClick={() => void mutate({ action: "request_status", id: item.id, expectedStatus: item.status, status: item.status === "pending" ? "acknowledged" : "completed" })}>{item.status === "pending" ? "Mark seen" : "Complete"}</button><button className="ir-secondary" disabled={busy} onClick={() => void mutate({ action: "request_status", id: item.id, expectedStatus: item.status, status: "cancelled" })}>Dismiss</button></div></article>) : <p className="ir-empty">No open requests.</p>}
        <InternalRequestPushSettings />
      </section></> : null}{roster}{snapshot ? <section className="ir-panel ir-table-tools"><h2><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h2v2h-2ZM20 14v6h-6v-2" /></svg>Table QR codes <span>{snapshot.links?.length || 0}</span></h2><p>Create and number your tables, print their QR signs, or revoke a shared link.</p>
        {snapshot.role !== "staff" ? <details className="ir-table-create"><summary>Add a table</summary><form className="ir-link-form" onSubmit={event => { event.preventDefault(); void mutate({ action: "link_create", label, kind: "table" }); }}><label>Table number or name<input value={label} maxLength={60} required onChange={event => setLabel(event.target.value)} /></label><button disabled={busy || !label.trim()}>Create link</button></form></details> : null}
        {snapshot.links?.map(link => <article className="ir-link" key={link.id}><div><strong>{link.label}</strong><small>QR active</small>{snapshot.role !== "staff" ? <details className="ir-table-edit"><summary>Rename table</summary><form key={link.label} className="ir-rename-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate({ action: "link_update", id: link.id, label: String(form.get("label") || "") }); }}><input name="label" aria-label={`Table number or name for ${link.label}`} defaultValue={link.label} required maxLength={60} /><button disabled={busy}>Save name</button></form></details> : null}</div><div className="ir-actions"><a href={`/internal/club/${link.token}`} target="_blank" rel="noreferrer">Open</a><a href={`/internal/sign/${link.token}`} target="_blank" rel="noreferrer">Print QR sign</a><button className="ir-secondary" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/internal/club/${link.token}`).then(() => setNotice("Club link copied.")).catch(() => setNotice("Open the link and copy its address."))}>Copy</button>{snapshot.role !== "staff" ? <button className="ir-secondary ir-revoke" disabled={busy} onClick={() => { if (window.confirm(`Revoke ${link.label}? Its current QR code and shared link will stop working.`)) void mutate({ action: "link_revoke", id: link.id }); }}>Revoke</button> : null}</div></article>)}
      </section> : null}</div> : null}
    <ClubProfileDialog profile={profile} profileId={openingProfileId || profile?.id} token={token} request={token && snapshot?.kind === "table" ? { tableLabel: snapshot.label || "our table", busy: requestingDancers.includes(profile?.id || ""), confirmed: confirmedDancers.includes(profile?.id || ""), message: notice } : undefined} onRequest={() => { if (profile) requestDancer(profile.id); }} onCancel={() => { if (profile) cancelDancer(profile.id, profile.requestId); }} onReady={() => setOpeningProfileId("")} onError={() => { selectedProfile.current = ""; setProfile(null); setOpeningProfileId(""); setNotice("That profile could not load. Please try again."); }} onClose={() => { selectedProfile.current = ""; setProfile(null); setOpeningProfileId(""); }} />
    {!operationsOnly ? <footer>Powered by MyDancr · {staff ? "Visibility is chosen by each dancer at check-in." : "Availability may change. Club staff coordinate all requests."}</footer> : null}
  </div>;
}

function ClubProfileDialog({ profile, profileId = profile?.id || "", token, request, onRequest, onCancel, onReady, onError, onClose }: { profile: Profile | null; profileId?: string; token?: string; request?: InternalRequestAction; onRequest?: () => void; onCancel?: () => void; onReady?: () => void; onError?: () => void; onClose: () => void }) {
  const profileDialog = useRef<HTMLDialogElement>(null);
  const [readyId, setReadyId] = useState("");
  useEffect(() => {
    if (profile && readyId === profileId && !profileDialog.current?.open) profileDialog.current?.showModal();
    if (!profileId) { profileDialog.current?.close(); setReadyId(""); }
  }, [profile, profileId, readyId]);
  return (
    <dialog className="ir-profile-dialog ir-full-profile-dialog" ref={profileDialog} onClose={onClose} aria-label={profile ? `${profile.stage_name}’s full profile` : "Dancer profile"}>
      {profileId ? <InternalFullProfile key={profileId} profileId={profileId} profile={profile} token={token} request={request} onRequest={onRequest} onCancel={onCancel} onReady={() => { setReadyId(profileId); onReady?.(); }} onError={onError || onClose} onClose={onClose} /> : null}
    </dialog>
  );
}

export function VenueRosterProfileButton({ dancerId, stageName }: { dancerId: string; stageName: string }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) { setProfile(null); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let hasProfile = false;
    const clear = () => { setProfile(null); setOpen(false); };
    const poll = async () => {
      try {
        const data = await rosterFetch('/api/internal/profile/' + dancerId, undefined, undefined, controller.signal);
        if (controller.signal.aborted) return;
        hasProfile = true; setProfile(data.profile); setError("");
      } catch (reason) {
        if (!controller.signal.aborted && (reason instanceof RosterAccessError || !hasProfile)) {
          clear(); setError(reason instanceof Error ? reason.message : "Profile unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, ROSTER_REFRESH_INTERVAL_MS);
      }
    };
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === BROWSER_AUTH_SESSION_KEY) {
        controller.abort(); clearTimeout(timer); clear();
      }
    };
    window.addEventListener("storage", sessionChanged);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("storage", sessionChanged); };
  }, [open, dancerId]);
  return <div className="ir-profile-control ir-staff"><button type="button" onClick={() => setOpen(true)} aria-label={`View ${stageName} profile`}>View profile</button>{error ? <small role="status">{error}</small> : null}<ClubProfileDialog profile={profile} onClose={() => { setOpen(false); setProfile(null); }} /></div>;
}
