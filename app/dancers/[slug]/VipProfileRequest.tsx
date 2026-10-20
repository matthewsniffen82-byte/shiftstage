"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DASHBOARD_SESSION_KEY, readSession, requestDashboardJson } from "@/app/dashboard/dashboard-session";
import { safeLocalReturnPath } from "@/src/lib/dancr/safe-return-path";
import type { VipState, VipVenue } from "@/src/lib/dancr/vip-types";
import { queueVipProfileDancer } from "@/src/lib/dancr/vip-draft-storage";
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
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);
  const locked = useRef(false);
  const venue = access?.accountId === accountId && access.venue.id === venueId ? access.venue : null;
  const queueHref = `/vip?venueId=${encodeURIComponent(venueId)}#vip-plan`;

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
    setAccess(null); setFallback(false); setLoadError(""); setError(""); setQueued(false);
    locked.current = false;
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
      }).catch(failure => {
        if (controller.signal.aborted || signedInCustomer() !== accountId) return;
        if (failure?.status === 401 || failure?.status === 403) setFallback(true);
        else setLoadError("Unable to check VIP access. Try again.");
      });
    }
    return () => controller.abort();
  }, [accountId, dancerId, venueId, revision]);

  function addToQueue() {
    if (locked.current || queued || !venue || !access?.available || !accountId) return;
    if (signedInCustomer() !== accountId) { setAccountId(signedInCustomer()); return; }
    locked.current = true; setError("");
    try {
      queueVipProfileDancer(window.localStorage, accountId, venueId, dancerId);
      setQueued(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to add this dancer. Open My dancers and try again.");
      locked.current = false;
    }
  }

  if (!venueId || accountId === "" || fallback) return children;
  return <div className="profile-tonight-deal vip-profile-request">
    <button type="button" className="vip-profile-request-action primary-action" disabled={!venue || !access?.available || queued}
      aria-label={`Request ${stageName}`} aria-busy={!venue && !loadError}
      onClick={addToQueue}>
      <span>{queued ? "Added to request queue" : "Request"}</span>{!queued && <span aria-hidden="true">›</span>}
    </button>
    {loadError && <div role="alert" className="vip-profile-request-hint">{loadError}
      <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button>
    </div>}
    {venue && !access?.available && <p className="vip-profile-request-hint">Unavailable to request at {venue.name}.</p>}
    {error && <p role="alert" className="vip-profile-request-hint">{error}</p>}
    {error && <a className="vip-profile-request-hint" href={queueHref}>Open My dancers →</a>}
  </div>;
}
