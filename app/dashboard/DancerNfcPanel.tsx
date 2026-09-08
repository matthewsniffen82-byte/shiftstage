"use client";

import { useEffect, useRef, useState } from "react";
import NfcIcon from "../components/NfcIcon";
import { requestDancerVenueVerificationJson } from "./dashboard-session";

type VenueSummary = { id?: string; name?: string; slug?: string; city?: string; state?: string | null };
type Affiliation = {
  id?: string;
  status?: string;
  approvedAt?: string | null;
  venue?: VenueSummary | null;
};
type NfcState = {
  profileAuthorization?: {
    authorized?: boolean;
    authorizedAt?: string | null;
    mediaReviewStatus?: string | null;
    isPublic?: boolean;
  };
  enrollment?: {
    status?: string;
    tappedAt?: string;
    expiresAt?: string;
    venue?: VenueSummary | null;
  } | null;
};

export default function DancerNfcPanel({
  compactAuthorized = false,
  initialAffiliations = [],
  initialNfcState,
  onAuthorizationChange,
}: {
  compactAuthorized?: boolean;
  initialAffiliations?: Array<Record<string, unknown>>;
  initialNfcState?: Record<string, unknown> | null;
  onAuthorizationChange?: () => void | Promise<void>;
}) {
  const [affiliations, setAffiliations] = useState<Affiliation[]>(initialAffiliations as Affiliation[]);
  const [nfcState, setNfcState] = useState<NfcState>((initialNfcState || {}) as NfcState);
  const [status, setStatus] = useState("");
  const [pendingId, setPendingId] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const activeAffiliations = affiliations.filter((item) => item.status === "active");
  const enrollment = nfcState.enrollment;
  const authorized = nfcState.profileAuthorization?.authorized === true || activeAffiliations.length > 0;
  const isPublic = nfcState.profileAuthorization?.isPublic === true;
  const pendingEnrollment = enrollment?.status === "pending";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
    };
  }, []);

  async function refresh() {
    if (!mountedRef.current) return;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setPendingId("refresh");
    setStatus("");
    try {
      const data = await requestDancerVenueVerificationJson({
        cache: "no-store",
        signal: controller.signal,
        fallbackMessage: "Unable to refresh venue access.",
      });
      if (!mountedRef.current || requestId !== actionSequenceRef.current) return;
      setAffiliations(data.affiliations || []);
      setNfcState({ profileAuthorization: data.profileAuthorization, enrollment: data.enrollment });
      await onAuthorizationChange?.();
      if (!mountedRef.current || requestId !== actionSequenceRef.current) return;
      setStatus("Dressing-room tap access is current.");
    } catch (error) {
      if (!mountedRef.current || requestId !== actionSequenceRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setStatus(error instanceof Error ? error.message : "Unable to refresh venue access.");
    } finally {
      if (requestId === actionSequenceRef.current) {
        actionAbortRef.current = null;
        if (mountedRef.current) setPendingId("");
      }
    }
  }

  async function removeAffiliation(affiliation: Affiliation) {
    if (!affiliation.id) return;
    const venueName = affiliation.venue?.name || "this venue";
    if (!window.confirm(`Remove venue access for ${venueName}? You will need to tap its dressing-room sticker again before going Working Now there.`)) return;
    if (!mountedRef.current) return;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setPendingId(affiliation.id);
    setStatus("");
    try {
      const data = await requestDancerVenueVerificationJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ affiliationId: affiliation.id }),
        signal: controller.signal,
        fallbackMessage: "Unable to remove venue access.",
      });
      if (!mountedRef.current || requestId !== actionSequenceRef.current) return;
      setAffiliations((current) => current.map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item));
      setStatus(data.message || "Venue access removed.");
    } catch (error) {
      if (!mountedRef.current || requestId !== actionSequenceRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setStatus(error instanceof Error ? error.message : "Unable to remove venue access.");
    } finally {
      if (requestId === actionSequenceRef.current) {
        actionAbortRef.current = null;
        if (mountedRef.current) setPendingId("");
      }
    }
  }

  const affiliationRoster = activeAffiliations.length ? (
    <div className="dancer-nfc-roster" aria-label="Tap-authorized venues">
      {activeAffiliations.map((affiliation) => (
        <section key={affiliation.id || affiliation.venue?.id}>
          <span>
            <strong>{affiliation.venue?.name || "Venue"}</strong>
            <small>Tap approved{affiliation.approvedAt ? ` · ${formatDate(affiliation.approvedAt)}` : ""}</small>
          </span>
          <button type="button" disabled={Boolean(pendingId)} onClick={() => removeAffiliation(affiliation)}>Remove</button>
        </section>
      ))}
    </div>
  ) : null;

  const checkInDetails = (
    <details className="dancer-nfc-details">
      <summary>How check-ins work</summary>
      <div>
        <p>Each check-in starts one six-hour Working Now session, followed by a six-hour cooldown before you can check in at any club again. Tapping again does not extend the session.</p>
        <p>Upcoming dates do not check you in. Only an active MyDancr dressing-room sticker can connect you to a club.</p>
        {!isPublic && !authorized ? <p>Finish profile setup and get your avatar and at least one profile photo approved before activation.</p> : null}
      </div>
    </details>
  );

  if (compactAuthorized && authorized) {
    const venueCount = activeAffiliations.length;
    return (
      <details className="info-panel dancer-nfc-panel-compact" id="dancer-venue-verification">
        <summary>
          <span className="dancer-nfc-compact-icon"><NfcIcon /></span>
          <span className="dancer-nfc-compact-copy">
            <strong>Venue access</strong>
            <small>{venueCount ? `${venueCount} approved club${venueCount === 1 ? "" : "s"}` : "Dressing-room tap approved"}</small>
          </span>
          <span className="dancer-nfc-compact-action">Manage</span>
        </summary>
        <div className="dancer-nfc-compact-body">
          <p>Tap any club&apos;s MyDancr dressing-room sticker to connect to that club and check in as Working Now. Once connected, you can post upcoming dates there.</p>
          {affiliationRoster}
          {checkInDetails}
          <button className="dancer-nfc-refresh" type="button" disabled={Boolean(pendingId)} onClick={refresh}>
            {pendingId === "refresh" ? "Refreshing…" : "Refresh access"}
          </button>
          {status ? <p className="dancer-nfc-status" role="status">{status}</p> : null}
        </div>
        <style>{DANCER_NFC_STYLE}</style>
      </details>
    );
  }

  return (
    <article className={`info-panel dancer-nfc-panel ${authorized ? "is-authorized" : ""}`} id="dancer-venue-verification">
      <div className="dancer-nfc-content">
        <div className="dancer-nfc-heading">
          <div className="dancer-nfc-icon"><NfcIcon /></div>
          <div>
            <span className="eyebrow">Dressing-room tap</span>
            <h2>{authorized ? "Profile activated" : pendingEnrollment ? "Tap saved — finish setup" : "Your first tap activates your profile"}</h2>
          </div>
        </div>
        {authorized ? (
          <p className="dancer-nfc-intro">You&apos;re activated. Tap the club&apos;s MyDancr dressing-room sticker each time you check in.</p>
        ) : pendingEnrollment ? (
          <p className="dancer-nfc-intro">Your tap at {enrollment?.venue?.name || "the club"} is saved. Finish your profile and required photo approvals to activate.</p>
        ) : (
          <p className="dancer-nfc-intro">Finish your profile, then unlock your signed-in phone and tap the MyDancr dressing-room sticker at the club.</p>
        )}

        <ol className="dancer-nfc-guide">
          {!authorized ? <li><strong>Activate once</strong><span>Your first tap activates your completed profile and checks you in at that club.</span></li> : null}
          <li><strong>Check in at any club</strong><span>Tap that club&apos;s MyDancr dressing-room sticker to connect to the club and show Working Now there.</span></li>
          <li><strong>Post upcoming dates</strong><span>Once connected to a club, you can post upcoming dates there.</span></li>
        </ol>
        {affiliationRoster}
        {checkInDetails}
        <button className="dancer-nfc-refresh" type="button" disabled={Boolean(pendingId)} onClick={refresh}>
          {pendingId === "refresh" ? "Checking…" : "Check activation status"}
        </button>
        {status ? <p className="dancer-nfc-status" role="status">{status}</p> : null}
      </div>
      <style>{DANCER_NFC_STYLE}</style>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const DANCER_NFC_STYLE = [
  ".dancer-nfc-panel{display:block;border-color:rgba(126,87,255,.34);background:radial-gradient(circle at 0 0,rgba(116,60,255,.14),transparent 22rem),rgba(12,12,18,.88)}",
  ".dancer-nfc-panel.is-authorized{border-color:rgba(73,255,170,.34);background:radial-gradient(circle at 0 0,rgba(25,190,116,.14),transparent 22rem),rgba(9,15,14,.9)}",
  ".dancer-nfc-icon{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;border-radius:12px;color:#fff;background:rgba(116,60,255,.2)}",
  ".is-authorized .dancer-nfc-icon{background:linear-gradient(145deg,#087a52,#22cb83);box-shadow:0 0 28px rgba(41,223,145,.3)}",
  ".dancer-nfc-icon svg{width:28px;height:28px;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
  ".dancer-nfc-content{min-width:0}.dancer-nfc-heading{display:flex;align-items:center;gap:12px}.dashboard-shell .dancer-nfc-heading h2{margin:3px 0 0;font-size:21px;line-height:1.2}.dashboard-shell .dancer-nfc-heading .eyebrow{font-size:10px;letter-spacing:.12em;color:#bca7da}.dashboard-shell .dancer-nfc-panel p.dancer-nfc-intro{margin:16px 0;font-size:14px;line-height:1.5;color:#d0c8db}",
  ".dashboard-shell .dancer-nfc-guide{display:grid;gap:15px;margin:18px 0;padding:0;list-style:none;counter-reset:tap-step}.dashboard-shell .dancer-nfc-guide>li{position:relative;display:grid;gap:3px;padding:0 0 0 34px;border:0;background:none;box-shadow:none;counter-increment:tap-step}.dancer-nfc-guide>li:before{content:counter(tap-step);position:absolute;left:0;top:0;width:23px;height:23px;display:grid;place-items:center;border:1px solid #7e57ff66;border-radius:50%;color:#d4c2ff;font-size:11px;font-weight:700}.dancer-nfc-guide strong{font-size:14px;line-height:1.4;color:#fff}.dancer-nfc-guide span{font-size:13px;line-height:1.5;color:#c4b9d2}",
  ".dashboard-shell details.dancer-nfc-details{margin:16px 0;padding:0;border:0;border-top:1px solid #ffffff14;border-radius:0;background:none;box-shadow:none}.dancer-nfc-details>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 0;color:#c9b6e7;font-size:12px;font-weight:600;cursor:pointer;list-style:none}.dancer-nfc-details>summary::-webkit-details-marker{display:none}.dancer-nfc-details>summary:after{content:'+';margin-left:auto;font-size:18px}.dancer-nfc-details[open]>summary:after{content:'−'}.dancer-nfc-details>summary:focus-visible{outline:2px solid #c9b6e7;outline-offset:2px}.dashboard-shell .dancer-nfc-details p{margin:0 0 10px;font-size:12px;line-height:1.5;color:#b9accd}",
  ".dancer-nfc-panel p,.dancer-nfc-panel small,.dancer-nfc-notes{color:#b9accd;line-height:1.45}.dancer-nfc-roster{display:grid;gap:7px;margin:14px 0}.dancer-nfc-roster section{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid rgba(69,255,165,.18);border-radius:11px;background:rgba(34,201,129,.06)}",
  ".dancer-nfc-roster span{display:grid;gap:2px}.dancer-nfc-roster small{font-size:11px}.dancer-nfc-roster button,.dancer-nfc-refresh{min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.15);border-radius:9px;color:#fff;background:rgba(255,255,255,.06);font:inherit;font-weight:800;cursor:pointer}",
  ".dancer-nfc-status{font-size:12px}.dancer-nfc-refresh{margin:0 0 10px}.dancer-nfc-panel small{display:block}.dashboard-shell .dancer-nfc-panel .dancer-nfc-refresh{width:100%;min-height:44px;margin:0;font-size:13px}",
  ".dashboard-shell .dancer-nfc-panel-compact{padding:0!important}.dancer-nfc-panel-compact>summary{box-sizing:border-box;min-height:68px;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;padding:10px 12px;cursor:pointer;list-style:none}.dancer-nfc-panel-compact>summary::-webkit-details-marker{display:none}.dancer-nfc-panel-compact>summary:focus-visible{outline:2px solid #8b5cf6;outline-offset:-3px}.dancer-nfc-compact-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;color:#70ffc1;background:rgba(34,201,129,.11)}.dancer-nfc-compact-icon svg{width:24px;height:24px;stroke:currentColor;stroke-width:1.7}.dancer-nfc-compact-copy{min-width:0;display:grid;gap:3px}.dancer-nfc-compact-copy strong{color:#fff;font-size:16px}.dancer-nfc-compact-copy small{color:#b9accd;font-size:11px}.dancer-nfc-compact-action{padding:6px 9px;border:1px solid rgba(69,255,165,.24);border-radius:999px;color:#70ffc1;font-size:10px;font-weight:900}.dancer-nfc-panel-compact[open] .dancer-nfc-compact-action{color:#fff}.dancer-nfc-compact-body{display:grid;gap:10px;padding:0 12px 12px;border-top:1px solid rgba(255,255,255,.08)}.dancer-nfc-compact-body>p{margin:12px 0 0;color:#b9accd;line-height:1.45}",
  "@media(max-width:620px){.dancer-nfc-roster section{align-items:flex-start}}",
].join("");
