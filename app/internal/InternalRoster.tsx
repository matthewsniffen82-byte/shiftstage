"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { venueGuestTheme } from "@/src/lib/dancr/venue-guest-theme";
import { DEMO_TABLE_REQUEST_COUNT } from "@/src/lib/dancr/venue-dashboard-demo";
import "./internal-guest-colors.css";
import VenueAdminUtilities from "../dashboard/VenueAdminUtilities";
import VenueGridImage from "../dashboard/VenueGridImage";
import { InternalRequestPushSettings } from "./InternalRequestPushSettings";
import type { InternalProfile as Profile } from "./InternalFullProfile";
import { ClubProfileDialog, type ProfileSelection } from "./FullProfileDialog";
import "../dashboard/venue-dancer-grid.css";
import { BROWSER_AUTH_SESSION_KEY, isCurrentBrowserSession, persistRefreshedBrowserAuthSession, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { ACCESS_TERMS_HREF, TABLE_REQUEST_NOTICE } from "@/src/lib/dancr/access-terms";

type Dancer = { id: string; stageName: string; workingUntil: string; avatarRevision: string; mainPhotoId: string | null; mainPhotoRevision: string; requestStatus?: "pending" | "acknowledged" | null; requestId?: string | null };
type ClubLink = { id: string; label: string };
type ClubRequest = { id: string; link_id: string; dancer_id: string; dancerName?: string; status: "pending" | "acknowledged"; created_at: string; attendance?: "arrived" | "no_show" | null; attendance_recorded_at?: string | null };
type TableRequestCard = ClubRequest & { sample?: true; tableLabel?: string };
type Snapshot = { venueName: string; venueSlug?: string; venueLogoUrl?: string | null; internalAccent?: string | null; dancers: Dancer[]; kind?: "table"; label?: string; role?: string; links?: ClubLink[]; requests?: ClubRequest[]; receipt?: { status: string } | null };
type DancerNotice = { message: string; error: boolean };

const ROSTER_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
// Match the public grid's pinned profile; only reorder dancers in the current roster.
const STAR_PROFILE_ID = "70e50bad-b7be-45ad-bc7a-64f1cba6b5e2";
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

const VenueProfileContext = createContext<((selection: ProfileSelection) => void) | null>(null);

function selectedCardPhoto(button?: HTMLButtonElement) {
  const image = button?.querySelector("img");
  return image?.currentSrc || image?.src || "";
}

function ProtectedMedia({ id, kind, token, alt, className, revision, priority = false, lazy = false, grid = false }: { id: string; kind: "avatar" | "photo" | "video"; token?: string; alt: string; className?: string; revision?: string; priority?: boolean; lazy?: boolean; grid?: boolean }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl("");
    setFailed(false);
    if (token) return; // Native images can stream and decode without waiting for a Blob.
    let objectUrl = "";
    const controller = new AbortController();
    const session = token ? null : readBrowserAuthSession();
    const headers: Record<string, string> = {};
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
    if (session?.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
    const timer = setTimeout(() => { setFailed(true); controller.abort(); }, 15000);
    void fetch(`/api/internal/${kind}/${id}${kind === "video" ? "" : "?width=320"}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.blob(); })
      .then(blob => { if (controller.signal.aborted || (session && !isCurrentBrowserSession(session))) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => { if (!controller.signal.aborted) { setUrl(""); setFailed(true); } })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, kind, token, revision]);
  const mediaUrl = token ? `/api/internal/${kind}/${id}?token=${encodeURIComponent(token)}&revision=${encodeURIComponent(revision || "")}${kind === "video" ? "" : "&width=320"}` : url;
  if (grid && kind !== "video") return <VenueGridImage src={mediaUrl} pending={!failed} lazy={lazy} priority={priority} />;
  return mediaUrl ? kind === "video" ? <video src={mediaUrl} controls playsInline preload="metadata" aria-label={alt} /> : <img className={className} src={mediaUrl} alt={alt} decoding="async" loading={lazy ? "lazy" : "eager"} fetchPriority={priority ? "high" : "auto"} /> : <span className={className} aria-label="Media loading">…</span>;
}

function VenueBrandLogo({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <h1 className="ir-venue-identity">{failed ? name : <img className="ir-venue-logo" src={url} alt={name} width={208} height={76} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</h1>;
}

export function InternalRoster({ token, operationsOnly = false, sampleTableRequests = false, roster }: { token?: string; operationsOnly?: boolean; sampleTableRequests?: boolean; roster?: ReactNode }) {
  const openVenueProfile = useContext(VenueProfileContext);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dancerNotices, setDancerNotices] = useState<Record<string, DancerNotice>>({});
  const noticeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const refreshNow = useRef<(manual?: boolean) => void>(() => {});
  const [busy, setBusy] = useState(false);
  const [requestingDancers, setRequestingDancers] = useState<string[]>([]);
  const [confirmedDancers, setConfirmedDancers] = useState<string[]>([]);
  const confirmationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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
  const openedOperation = useRef("");
  const hasSnapshot = useRef(false);
  const sampleTime = useRef(Date.now());
  const restoredProfile = useRef(false);
  const base = token ? `/api/internal/link/${encodeURIComponent(token)}` : "/api/internal";

  const clearRoster = useCallback((message = "") => {
    hasSnapshot.current = false;
    noticeTimers.current.forEach(clearTimeout); noticeTimers.current.clear(); setDancerNotices({});
    setSnapshot(null); setProfile(null); setOpeningProfileId(""); selectedProfile.current = ""; setError(message);
  }, []);

  function dismissDancerNotice(dancerId: string) {
    clearTimeout(noticeTimers.current.get(dancerId));
    noticeTimers.current.delete(dancerId);
    setDancerNotices(current => {
      const next = { ...current };
      delete next[dancerId];
      return next;
    });
  }

  function showDancerNotice(dancerId: string, message: string, error = false) {
    clearTimeout(noticeTimers.current.get(dancerId));
    noticeTimers.current.delete(dancerId);
    setDancerNotices(current => ({ ...current, [dancerId]: { message, error } }));
    // Keep errors available until dismissed or retried; confirmations are temporary.
    if (!error) noticeTimers.current.set(dancerId, setTimeout(() => {
      if (alive.current) dismissDancerNotice(dancerId);
    }, 10000));
  }

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
    const feedbackTimers = noticeTimers.current;
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
      feedbackTimers.forEach(clearTimeout); feedbackTimers.clear();
      window.removeEventListener("storage", sessionChanged);
      document.removeEventListener("visibilitychange", returned);
      window.removeEventListener("focus", returned);
      window.removeEventListener("pageshow", restored);
    };
  }, [refresh, token, clearRoster]);

  useEffect(() => {
    if (token || !snapshot) return;
    let frame = 0;
    const openOperation = () => {
      const sectionId = window.location.hash.slice(1);
      if (sectionId !== "table-requests" || openedOperation.current === sectionId) return;
      frame = window.requestAnimationFrame(() => {
        if (window.location.hash.slice(1) !== sectionId) return;
        const panel = document.getElementById(sectionId);
        if (!panel) return;
        openedOperation.current = sectionId;
        if (panel instanceof HTMLDetailsElement) panel.open = true;
        for (let parent = panel.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        panel.scrollIntoView({ block: "start" });
        panel.focus({ preventScroll: true });
      });
    };
    const hashChanged = () => { openedOperation.current = ""; openOperation(); };
    openOperation();
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
    if (dancerId) dismissDancerNotice(dancerId);
    else setNotice("");
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
      if (dancerId) showDancerNotice(dancerId, body.action === "cancel_request" ? "Request cancelled." : REQUEST_SENT_NOTICE);
      else setNotice("Saved.");
      // The receipt already confirms the guest's request; refresh details quietly.
      if (dancerId) void refresh();
      else await refresh();
    } catch (reason) {
      if (alive.current) {
        if (reason instanceof RosterAccessError) clearRoster(reason.message);
        else {
          const message = reason instanceof Error ? reason.message : "Unable to save.";
          if (dancerId) showDancerNotice(dancerId, message, true);
          else setNotice(message);
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

  async function openProfile(dancer: Dancer, photoUrl = "") {
    if (!token && openVenueProfile) {
      openVenueProfile({ id: dancer.id, stageName: dancer.stageName, photoUrl });
      return;
    }
    if (token) dismissDancerNotice(dancer.id);
    else setNotice("");
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
        else if (token) showDancerNotice(dancer.id, reason instanceof Error ? reason.message : "Profile unavailable.", true);
        else setNotice(reason instanceof Error ? reason.message : "Profile unavailable.");
      }
    }
  }

  const staff = !token;
  const dancers = (snapshot?.dancers || []).slice().sort((a, b) => Number(b.id === STAR_PROFILE_ID) - Number(a.id === STAR_PROFILE_ID));
  // Samples use authorized roster identities, but never enter the live request queue.
  const sampleRequests: TableRequestCard[] = staff && operationsOnly && sampleTableRequests
    ? [...new Map(dancers.map(dancer => [dancer.id, dancer])).values()]
      .sort((a, b) => a.stageName.localeCompare(b.stageName) || a.id.localeCompare(b.id)).slice(0, DEMO_TABLE_REQUEST_COUNT)
      .map((dancer, index) => ({
        id: `demo-table-${dancer.id}`, link_id: "", dancer_id: dancer.id, dancerName: dancer.stageName,
        tableLabel: `Table ${index + 1}`, sample: true,
        status: index < 6 ? "pending" : "acknowledged",
        attendance: index >= 8 ? "arrived" : null,
        created_at: new Date(sampleTime.current - (index + 1) * 60_000).toISOString(),
      })) : [];
  const requestCards: TableRequestCard[] = [
    ...(snapshot?.requests || []).slice().sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || Date.parse(b.created_at) - Date.parse(a.created_at)),
    ...sampleRequests,
  ];
  // Table snapshots already carry each dancer's active request, including after reload.
  // A receipt alone has no dancer identity; never assign it to an unrelated card.
  const tableRequests = staff ? [] : dancers.filter(dancer => dancer.requestStatus);
  const receiptStatus = snapshot?.receipt?.status;
  const inactiveReceipt = !!receiptStatus && ["completed", "cancelled", "expired"].includes(receiptStatus);
  // Show progress until the first response supplies the real venue/table identity.
  if (!staff && !snapshot && !error) return <div className="ir-shell ir-guest" aria-busy={true} data-global-navigation-swipe="ignore">
    <div className="ir-loading-status" role="status">
      <span className="ir-loading-spinner" aria-hidden="true" />
      <span>Loading dancers…</span>
    </div>
  </div>;
  return <div className={`ir-shell${staff ? " ir-staff" : " ir-guest"}${operationsOnly ? " ir-embedded" : ""}`} data-global-navigation-swipe="ignore"
    data-venue-brand={operationsOnly ? undefined : snapshot?.venueSlug}
    data-venue-guest-color={!staff && venueGuestTheme(snapshot?.internalAccent) ? "custom" : undefined}
    style={(!staff ? venueGuestTheme(snapshot?.internalAccent) : undefined) as CSSProperties | undefined}>
    {staff && !operationsOnly ? <VenueAdminUtilities /> : null}
    {!operationsOnly && (staff || snapshot) ? <header className="ir-header"><div>
      <a className="ir-brand" href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer"><span className="ir-brand-caption">Powered by mydancr.com</span>{staff ? <span>INTERNAL</span> : null}</a>
      {!staff && snapshot?.venueLogoUrl ? <VenueBrandLogo key={snapshot.venueLogoUrl} url={snapshot.venueLogoUrl} name={snapshot.venueName} /> : <h1 className={staff ? undefined : "ir-venue-identity"}>{snapshot?.venueName || "Club roster"}</h1>}
      <p>{staff ? "Your floor. Your team. One live roster." : snapshot?.label || "Welcome to the club"}</p>
    </div>{staff ? <a className="ir-secondary" href="/dashboard/venue">Club dashboard</a> : null}</header> : null}
    {error ? <section className="ir-panel" role="alert"><h2>Roster unavailable</h2><p>{error}</p>{staff ? <a className="ir-button" data-sign-in-action href="/account?role=venue&mode=login&return_to=%2Finternal">Sign in to MyDancr</a> : null}<button onClick={() => void refresh()}>Try again</button></section> : !snapshot && !operationsOnly ? <p role="status">Loading the live roster…</p> : null}
    {notice ? <p className="ir-notice" role="status">{notice}</p> : null}
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
        {dancers.length ? <div className="ir-grid ir-directory-grid">{dancers.map((dancer, index) => <article className={`ir-dancer${snapshot.kind === "table" ? " ir-dancer-requestable" : ""}`} key={dancer.id} data-request-state={!staff ? dancer.requestStatus || undefined : undefined} data-has-notice={!!dancerNotices[dancer.id] || undefined}>
          <button type="button" className="ir-profile-link" aria-label={`View ${dancer.stageName}’s full profile`} aria-describedby={dancerNotices[dancer.id] ? `ir-dancer-notice-${dancer.id}` : undefined} aria-busy={openingProfileId === dancer.id} onClick={event => void openProfile(dancer, selectedCardPhoto(event?.currentTarget))}>
            {dancer.mainPhotoId ? <ProtectedMedia key={dancer.mainPhotoId} id={dancer.mainPhotoId} revision={dancer.mainPhotoRevision} kind="photo" token={token} priority={index < 3} lazy={index >= 9} className="ir-main-photo" alt={`${dancer.stageName}’s main photo`} /> : <span className="ir-main-photo ir-photo-placeholder">Photo unavailable</span>}
            {!staff && dancer.requestStatus ? <span className="ir-card-request-state">{dancer.requestStatus === "acknowledged" ? "Seen by staff" : "Requested ✓"}</span> : null}
            <span className="ir-dancer-copy"><strong>{dancer.stageName}</strong><span>{openingProfileId === dancer.id ? "Opening…" : "View profile ↗"}</span></span>
          </button>
          {snapshot.kind === "table" ? <button type="button" className="ir-table-request"
            data-request-sent={dancer.requestStatus ? "" : undefined}
            aria-label={confirmedDancers.includes(dancer.id) ? `Request sent for ${dancer.stageName}` : dancer.requestStatus ? `Cancel request for ${dancer.stageName}` : `Request ${dancer.stageName} at our table`}
            aria-busy={requestingDancers.includes(dancer.id)}
            aria-describedby={dancerNotices[dancer.id] ? `ir-dancer-notice-${dancer.id}` : undefined}
            disabled={requestingDancers.includes(dancer.id) || confirmedDancers.includes(dancer.id) || Boolean(dancer.requestStatus && !dancer.requestId)}
            onClick={() => dancer.requestStatus ? cancelDancer(dancer.id, dancer.requestId) : requestDancer(dancer.id)}>
            {requestingDancers.includes(dancer.id) ? dancer.requestStatus ? "Cancelling…" : "Sending…" : confirmedDancers.includes(dancer.id) ? <span className="internal-request-sent-label">Request sent</span> : dancer.requestStatus ? "Cancel request" : "Request"}
          </button> : null}
          {dancerNotices[dancer.id] ? <div className="ir-dancer-notice" data-error={dancerNotices[dancer.id].error || undefined}>
            <div id={`ir-dancer-notice-${dancer.id}`} role={dancerNotices[dancer.id].error ? "alert" : "status"} aria-atomic="true">
              <strong>{dancer.stageName}</strong>
              <p>{dancerNotices[dancer.id].message}</p>
            </div>
            <button type="button" className="ir-dancer-notice-dismiss" aria-label={`Dismiss message for ${dancer.stageName}`} title="Dismiss message" onClick={() => dismissDancerNotice(dancer.id)}><span aria-hidden="true">×</span></button>
          </div> : null}
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
      {/* Keep table requests ahead of the independently loaded roster,
          including the first paint. Unknown counts must not appear as zero. */}
      {staff ? <div className="ir-operations"><section className="ir-panel venue-card-region" id="table-requests" tabIndex={-1} aria-busy={!snapshot && !error || undefined}><h2><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v13H9l-5 4ZM8 8h8M8 12h5" /></svg>Table requests <span>{snapshot ? sampleRequests.length ? `${snapshot.requests?.length || 0} live` : snapshot.requests?.length || 0 : "—"}</span></h2>
        {snapshot ? <>
        {sampleRequests.length ? <p className="venue-table-sample-count">{sampleRequests.length} sample requests</p> : null}
        {requestCards.length ? <div className="venue-dancer-grid" aria-label="Table request cards">{requestCards.map((item, index) => {
          const dancer = snapshot.dancers.find(row => row.id === item.dancer_id);
          const dancerName = item.dancerName || dancer?.stageName || "Dancer";
          const tableLabel = item.sample ? item.tableLabel : snapshot.links?.find(link => link.id === item.link_id)?.label || "Table";
          const requestState = item.status === "pending" ? "pending" : item.attendance === "arrived" ? "arrived" : "acknowledged";
          const requestLabel = item.status === "pending" ? "New request" : item.attendance === "arrived" ? "Arrived at table" : "Seen by staff";
          const identity = <span className="venue-card-portrait"><span className="venue-card-photo" aria-hidden="true">
            {dancer ? <ProtectedMedia key={`${dancer.mainPhotoId || dancer.id}:${dancer.mainPhotoRevision || dancer.avatarRevision}`} id={dancer.mainPhotoId || dancer.id} kind={dancer.mainPhotoId ? "photo" : "avatar"} revision={dancer.mainPhotoId ? dancer.mainPhotoRevision : dancer.avatarRevision} alt="" grid lazy={index >= 12} priority={index < 3} /> : <VenueGridImage />}</span>
            <span className="venue-card-caption"><strong>{dancerName}</strong><small>{item.sample ? `Sample · ${tableLabel}` : tableLabel}</small><span className="venue-card-status" data-state={requestState}>{openingProfileId === dancer?.id ? "Opening…" : requestLabel}</span></span></span>;
          return <article className="venue-dancer-card" data-request-id={item.id} data-sample={item.sample || undefined} key={item.id}><div className="venue-table-request-identity">
            {dancer ? <button type="button" className="ir-profile-link venue-card-profile" aria-label={`View ${dancerName} profile`} aria-busy={openingProfileId === dancer.id} onClick={event => void openProfile(dancer, selectedCardPhoto(event?.currentTarget))}>{identity}</button>
              : identity}</div>
            <details className="venue-card-menu" name="venue-card-details"><summary className="dashboard-menu-trigger" aria-label={`${tableLabel} request details for ${dancerName}`} title="Request details"><span className="dashboard-menu-dots" aria-hidden="true">•••</span></summary>
            <div className="venue-card-popover"><div className="venue-card-details"><strong>{tableLabel} · {dancerName}</strong>
              {item.sample ? <small>Sample request</small> : null}
              <span className="venue-card-status" data-state={requestState}>{requestLabel}</span>
              <small>Received: <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></small>
            </div>{!item.sample ? <div className="ir-actions venue-card-actions">
          {item.status === "pending" || item.attendance === "arrived" ? <button disabled={busy} onClick={() => void mutate({ action: "request_status", id: item.id, expectedStatus: item.status, status: item.status === "pending" ? "acknowledged" : "completed" })}>{item.status === "pending" ? "Mark seen" : "Complete"}</button> : <>
            <button disabled={busy} onClick={() => void mutate({ action: "request_attendance", id: item.id, expectedStatus: item.status, attendance: "arrived" })}>Mark arrived</button>
            <button className="ir-secondary" disabled={busy} onClick={() => void mutate({ action: "request_attendance", id: item.id, expectedStatus: item.status, attendance: "no_show" })}>Didn’t arrive at table</button>
          </>}
          <button className="ir-secondary" disabled={busy} onClick={() => void mutate({ action: "request_status", id: item.id, expectedStatus: item.status, status: "cancelled" })}>Dismiss</button></div> : null}</div></details></article>;
        })}</div> : <p className="ir-empty">No open requests.</p>}
        <InternalRequestPushSettings />
        </> : <>
          <p role="status">{error ? "Table requests unavailable." : "Loading table requests…"}</p>
          {!error ? <div className="venue-dancer-grid" aria-hidden="true"><span className="venue-dancer-card" /><span className="venue-dancer-card" /><span className="venue-dancer-card" /></div> : null}
        </>}
      </section>{roster}</div> : null}
    {!staff || !openVenueProfile ? <ClubProfileDialog prewarm={!!snapshot} profile={profile} profileId={openingProfileId || profile?.id} token={token} request={token && snapshot?.kind === "table" ? { tableLabel: snapshot.label || "our table", busy: requestingDancers.includes(profile?.id || ""), confirmed: confirmedDancers.includes(profile?.id || ""), message: dancerNotices[profile?.id || openingProfileId]?.message || "" } : undefined} onRequest={() => { if (profile) requestDancer(profile.id); }} onCancel={() => { if (profile) cancelDancer(profile.id, profile.requestId); }} onReady={() => setOpeningProfileId("")} onError={() => {
      const dancerId = selectedProfile.current;
      selectedProfile.current = ""; setProfile(null); setOpeningProfileId("");
      if (token && dancerId) showDancerNotice(dancerId, "That profile could not load. Please try again.", true);
      else setNotice("That profile could not load. Please try again.");
    }} onClose={() => { selectedProfile.current = ""; setProfile(null); setOpeningProfileId(""); }} /> : null}
    {!operationsOnly ? <footer className="ir-powered-by">
      <a href="https://www.mydancr.com" target="_blank" rel="noopener noreferrer"><span>Powered by MyDancr</span><span>www.mydancr.com</span></a>
      <p>{staff ? "Visibility is chosen by each dancer at check-in." : "Availability may change. Club staff coordinate all requests."}</p>
    </footer> : null}
  </div>;
}

/** One warm discovery viewer serves every dancer card in a venue workspace. */
export function VenueProfileProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<ProfileSelection | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const { profile, error, fail } = useStaffProfile(selection?.id || "", !!selection, close, selection?.photoUrl);
  return <VenueProfileContext.Provider value={setSelection}>
    {children}
    {error ? <p role="status" className="ir-notice">{error}</p> : null}
    <ClubProfileDialog prewarm profile={profile} profileId={selection?.id || ""} loadingIdentity={selection} onError={fail} onClose={close} />
  </VenueProfileContext.Provider>;
}

function useStaffProfile(dancerId: string, open: boolean, onClose: () => void, photoUrl = "") {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const latest = useRef({ onClose, photoUrl });
  latest.current = { onClose, photoUrl };
  const fail = useCallback(() => {
    setProfile(null); setError("That profile could not load. Please try again."); latest.current.onClose();
  }, []);
  useEffect(() => {
    setProfile(null);
    if (!open) return;
    setError("");
    let session = readBrowserAuthSession();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let hasProfile = false;
    const clear = () => { setProfile(null); latest.current.onClose(); };
    const poll = async () => {
      try {
        if (!session || !isCurrentBrowserSession(session)) throw new RosterAccessError("Your account session changed. Refresh this page.");
        const data = await rosterFetch('/api/internal/profile/' + dancerId, undefined, undefined, controller.signal);
        if (controller.signal.aborted) return;
        // rosterFetch validates the previous session before persisting refreshed credentials.
        session = readBrowserAuthSession();
        if (data.profile?.id !== dancerId) throw new RosterAccessError("This dancer’s full profile could not be confirmed. Refresh and try again.");
        hasProfile = true; setProfile({ ...data.profile, initialPhotoUrl: latest.current.photoUrl }); setError("");
      } catch (reason) {
        if (!controller.signal.aborted && (reason instanceof RosterAccessError || !hasProfile)) {
          controller.abort(); clear(); setError(reason instanceof Error ? reason.message : "Profile unavailable.");
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
    const checkSession = () => {
      if (!session || !isCurrentBrowserSession(session)) { controller.abort(); clearTimeout(timer); clear(); }
    };
    window.addEventListener("storage", sessionChanged);
    window.addEventListener("focus", checkSession);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("storage", sessionChanged); window.removeEventListener("focus", checkSession); };
  }, [open, dancerId]);
  // Do not expose the previous dancer for a render while an effect switches IDs.
  return { profile: open && profile?.id === dancerId ? profile : null, error, fail };
}

export function VenueRosterProfileButton({ dancerId, stageName, children, className }: { dancerId: string; stageName: string; children?: ReactNode; className?: string }) {
  const openVenueProfile = useContext(VenueProfileContext);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { profile, error, fail } = useStaffProfile(dancerId, open && !openVenueProfile, close);
  return <div className="ir-profile-control ir-staff"><button type="button" className={className} onClick={event => {
    if (openVenueProfile) openVenueProfile({ id: dancerId, stageName, photoUrl: selectedCardPhoto(event?.currentTarget) });
    else setOpen(true);
  }} aria-label={`View ${stageName} profile`} aria-busy={open && !profile}>{children || "View profile"}</button>{error ? <small role="status">{error}</small> : null}{!openVenueProfile ? <ClubProfileDialog profile={profile} profileId={open ? dancerId : ""} loadingIdentity={{ id: dancerId, stageName }} onError={fail} onClose={close} /> : null}</div>;
}
