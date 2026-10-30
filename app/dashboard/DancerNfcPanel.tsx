"use client";
import RefreshButton from "../components/RefreshButton";

import { useEffect, useRef, useState } from "react";
import NfcIcon from "../components/NfcIcon";
import { requestDancerVenueVerificationJson } from "./dashboard-session";
import { VISIBILITY_OPTIONS } from "@/src/lib/dancr/visibility-mode";
import { dancerCheckInState, type DancerCheckInSnapshot } from "@/src/lib/dancr/dancer-check-in-state";

type VenueSummary = { id?: string; name?: string; slug?: string; city?: string; state?: string | null };
type Affiliation = {
  id?: string;
  status?: string;
  approvedAt?: string | null;
  venue?: VenueSummary | null;
};
type NfcState = {
  clubApprovals?: Array<{ status: string; expiresAt?: string | null; venue?: VenueSummary | null }>;
  profileAuthorization?: {
    authorized?: boolean;
    profileStatus?: string | null;
    authorizedAt?: string | null;
    mediaReviewStatus?: string | null;
    isPublic?: boolean;
    visibility?: string | null;
  };
  enrollment?: {
    status?: string;
    tappedAt?: string;
    expiresAt?: string;
    checkInStatus?: string | null;
    venue?: VenueSummary | null;
  } | null;
  presence?: DancerCheckInSnapshot["presence"];
};

const EMPTY_AFFILIATIONS: Array<Record<string, unknown>> = [];

export default function DancerNfcPanel({
  compactAuthorized = false,
  onboarding = false,
  initialAffiliations = EMPTY_AFFILIATIONS,
  initialNfcState,
  onAuthorizationChange,
  onCheckInChange,
}: {
  compactAuthorized?: boolean;
  onboarding?: boolean;
  initialAffiliations?: Array<Record<string, unknown>>;
  initialNfcState?: Record<string, unknown> | null;
  onAuthorizationChange?: () => void | Promise<void>;
  onCheckInChange?: (snapshot: DancerCheckInSnapshot) => void;
}) {
  const [affiliations, setAffiliations] = useState<Affiliation[]>(initialAffiliations as Affiliation[]);
  const [nfcState, setNfcState] = useState<NfcState>((initialNfcState || {}) as NfcState);
  const [status, setStatus] = useState("");
  const [pendingId, setPendingId] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const activeAffiliations = affiliations.filter((item) => item.status === "active");
  const authorized = nfcState.profileAuthorization?.authorized === true && nfcState.profileAuthorization.profileStatus === "approved";
  const checkIn = dancerCheckInState({ ...nfcState, affiliations });
  const showFirstTapInstructions = onboarding && checkIn.stage === "no_tap";
  const visibility = VISIBILITY_OPTIONS.find(option => option.value === nfcState.profileAuthorization?.visibility);
  const visibilitySummary = visibility ? <p className="dancer-nfc-status">Last NFC choice: <strong>{visibility.label}</strong>. {visibility.description}</p> : null;

  useEffect(() => {
    if (initialNfcState) setNfcState(initialNfcState as NfcState);
    setAffiliations(initialAffiliations as Affiliation[]);
  }, [initialNfcState, initialAffiliations]);

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
        fallbackMessage: "Unable to refresh club access.",
      });
      if (!mountedRef.current || requestId !== actionSequenceRef.current) return;
      const refreshedAffiliations: Affiliation[] = data.affiliations || [];
      const refreshedNfcState: NfcState = { profileAuthorization: data.profileAuthorization, enrollment: data.enrollment, clubApprovals: data.clubApprovals, presence: data.presence };
      setAffiliations(refreshedAffiliations);
      setNfcState(refreshedNfcState);
      onCheckInChange?.({ ...refreshedNfcState, affiliations: refreshedAffiliations });
      await onAuthorizationChange?.();
      if (!mountedRef.current || requestId !== actionSequenceRef.current) return;
      const refreshedCheckIn = dancerCheckInState({ ...refreshedNfcState, affiliations: refreshedAffiliations });
      setStatus(`${refreshedCheckIn.title}. ${refreshedCheckIn.description}`);
    } catch (error) {
      if (!mountedRef.current || requestId !== actionSequenceRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setStatus(error instanceof Error ? error.message : "Unable to refresh club access.");
    } finally {
      if (requestId === actionSequenceRef.current) {
        actionAbortRef.current = null;
        if (mountedRef.current) setPendingId("");
      }
    }
  }

  async function removeAffiliation(affiliation: Affiliation) {
    if (!affiliation.id) return;
    const venueName = affiliation.venue?.name || "this club";
    if (!window.confirm(`Remove club access for ${venueName}? You will need to tap its dancer check-in tag again before going Working Now there.`)) return;
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
        fallbackMessage: "Unable to remove club access.",
      });
      if (!mountedRef.current || requestId !== actionSequenceRef.current) return;
      setAffiliations((current) => current.map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item));
      setStatus(data.message || "Club access removed.");
    } catch (error) {
      if (!mountedRef.current || requestId !== actionSequenceRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setStatus(error instanceof Error ? error.message : "Unable to remove club access.");
    } finally {
      if (requestId === actionSequenceRef.current) {
        actionAbortRef.current = null;
        if (mountedRef.current) setPendingId("");
      }
    }
  }

  const affiliationRoster = activeAffiliations.length ? (
    <div className="dancer-nfc-roster" aria-label="Tap-authorized clubs">
      {activeAffiliations.map((affiliation) => (
        <section key={affiliation.id || affiliation.venue?.id}>
          <span>
            <strong>{affiliation.venue?.name || "Club"}</strong>
            {affiliation.venue?.city ? <small>{affiliation.venue.city}</small> : null}
          </span>
          <button type="button" disabled={Boolean(pendingId)} onClick={() => removeAffiliation(affiliation)}>Remove</button>
        </section>
      ))}
    </div>
  ) : null;

  const clubRequests = nfcState.clubApprovals?.length ? <div className="dancer-nfc-roster" aria-label="Club approval requests">
    {nfcState.clubApprovals.filter(request => !activeAffiliations.some(item => item.venue?.id === request.venue?.id)).map(request => <section key={request.venue?.id}><span><strong>{request.venue?.name || "Club"}</strong><small>{request.status === "approved"
      ? "Club confirmed. Required media approval must finish before you can check in."
      : request.status === "rejected" ? "Request declined — contact this club’s manager."
      : request.expiresAt && Date.parse(request.expiresAt) <= Date.now() ? "Request expired — tap this club’s sticker again to renew it."
      : "Awaiting this club’s approval. You are not checked in there."}</small></span></section>)}
  </div> : null;

  const checkInDetails = showFirstTapInstructions ? null : (
    <details className="dancer-nfc-details">
      <summary>How check-ins work</summary>
      <div>
        <ul>
          <li>Tap the club’s tag and sign in if prompted. Choose your visibility, then confirm.</li>
          <li>Each new club reviews your profile and media. When your profile, required media and club approval are ready, your saved tap checks you in for the time left in its six-hour window. After that, tap again. Media permissions are separate at each club.</li>
          <li>Working Now lasts <strong>6 hours</strong>, followed by a <strong>6-hour cooldown</strong> at that club. Check out before tapping into another approved club. Tapping again won&apos;t extend the current session.</li>
          <li>Choose Internal only, External only, or Both at each tap. Internal only includes this club’s invited VIP guests, who may be viewing remotely.</li>
        </ul>
        {checkIn.stage === "no_tap" ? <p>Your first tap will request access and send pending media to the club for review.</p> : null}
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
            <strong>Club access</strong>
            <small>{venueCount ? `${venueCount} approved club${venueCount === 1 ? "" : "s"}` : "Dancer check-in tap approved"}{nfcState.clubApprovals?.length ? " · Check your club requests" : ""}</small>
          </span>
          <span className="dancer-nfc-compact-action">Manage</span>
        </summary>
        <div className="dancer-nfc-compact-body">
          <p><strong>{checkIn.title}</strong><br />{checkIn.description}</p>
          {visibilitySummary}
          {affiliationRoster}
          {clubRequests}
          {checkInDetails}
          <RefreshButton label="Refresh check-in access" busy={pendingId === "refresh"} className="dancer-nfc-refresh" type="button" disabled={Boolean(pendingId)} onClick={refresh} />
          {status ? <p className="dancer-nfc-status" role="status">{status}</p> : null}
        </div>
        <style>{DANCER_NFC_STYLE}</style>
      </details>
    );
  }

  return (
    <article className={`info-panel dancer-nfc-panel ${authorized ? "is-authorized" : ""}`} id="dancer-venue-verification" data-first-tap={showFirstTapInstructions || undefined}>
      <div className="dancer-nfc-content">
        <div className="dancer-nfc-heading">
          <div className="dancer-nfc-icon"><NfcIcon /></div>
          <div>
            <span className="eyebrow">{onboarding ? "Club & media approval" : "Dancer check-in tap"}</span>
            <h2>{checkIn.title}</h2>
          </div>
        </div>
        {showFirstTapInstructions ? <>
          <div className="dancer-nfc-next-step">
            <span className="dancer-nfc-next-step-icon"><NfcIcon /></span>
            <h3>Next: Tap the club’s tag</h3>
            <p>Hold your phone near the dancer check-in tag at your club. Choose your visibility, then confirm.</p>
          </div>
          <div className="dancer-nfc-approval-details">
            <p>Your profile and media will be submitted for approval. We’ll notify you when approved or if changes are needed.</p>
            <p>Approval within 6 hours of your tap activates your check-in automatically. Otherwise, tap again to show <strong>Working now</strong>. Tap at the start of each new shift.</p>
          </div>
        </> : <p className="dancer-nfc-intro">{onboarding && checkIn.stage !== "no_tap" ? <><strong>{checkIn.title}</strong><br /></> : null}{checkIn.stage === "no_tap" ? "Tap the club’s tag, choose your visibility, and confirm." : checkIn.description}</p>}

        {!onboarding ? <ol className="dancer-nfc-guide">
          {!authorized ? <li><strong>Activate once</strong><span>Your first tap requests club approval. Your profile and required media must be approved within six hours of that tap to complete its saved check-in. Otherwise, tap again once approved.</span></li> : null}
          <li><strong>Check in at any club</strong><span>Each club approves you separately. Once approved, tap its dancer check-in tag to show Working Now there.</span></li>
          <li><strong>Choose where you appear</strong><span>Select Internal only, External only, or Both. Your full profile is required for every choice.</span></li>
        </ol> : null}
        {visibilitySummary}
        {affiliationRoster}
        {clubRequests}
        {checkInDetails}
        <RefreshButton label="Check status" busy={pendingId === "refresh"} className="dancer-nfc-refresh" type="button" disabled={Boolean(pendingId)} onClick={refresh}>
          {pendingId === "refresh" ? "Checking…" : "Check status"}
        </RefreshButton>
        {status ? <p className="dancer-nfc-status" role="status">{status}</p> : null}
      </div>
      <style>{DANCER_NFC_STYLE}</style>
    </article>
  );
}

const DANCER_NFC_STYLE = [
  ".dancer-nfc-panel,.dancer-nfc-panel-compact{--dancr-color-text-primary:#f5f5f5;--dancr-color-text-muted:#b8b8b8;--dancr-color-text-secondary:#b8b8b8}",
  "@layer dancr-palette{html body.dancr-button-system #dancer-venue-verification :is(p,small,li){color:var(--dancr-color-text-muted)!important}}",
  ".dancer-nfc-panel{display:block;border-color:var(--dancr-color-border);background:var(--dancr-color-surface-card)}",
  ".dancer-nfc-panel.is-authorized{border-color:rgba(73,255,170,.34);background:radial-gradient(circle at 0 0,rgba(25,190,116,.14),transparent 22rem),rgba(9,15,14,.9)}",
  ".dancer-nfc-icon{width:44px;height:44px;flex:0 0 44px;display:grid;place-items:center;border-radius:12px;color:#fff;background:var(--dancr-color-surface-card)}",
  ".is-authorized .dancer-nfc-icon{background:linear-gradient(145deg,#087a52,#22cb83);box-shadow:0 0 28px rgba(41,223,145,.3)}",
  ".dancer-nfc-icon svg{width:28px;height:28px;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
  ".dancer-nfc-content{min-width:0}.dancer-nfc-heading{display:flex;align-items:center;gap:12px}.dashboard-shell .dancer-nfc-heading h2{margin:3px 0 0;font-size:21px;line-height:1.2}.dashboard-shell .dancer-nfc-heading .eyebrow{font-size:10px;letter-spacing:.12em;color:var(--dancr-color-text-muted)}.dashboard-shell .dancer-nfc-panel p.dancer-nfc-intro{margin:16px 0;font-size:14px;line-height:1.5;color:var(--dancr-color-text-muted)}",
  "@layer dancr-palette{html body.dancr-button-system #dancer-venue-verification .dancer-nfc-next-step{display:grid;grid-template-columns:36px minmax(0,1fr);align-items:center;gap:10px;margin:0 0 14px;padding:14px;border-left:3px solid var(--dancr-color-brand-primary);border-radius:0 12px 12px 0;background:var(--dancr-color-surface-raised)}html body.dancr-button-system #dancer-venue-verification .dancer-nfc-next-step-icon{display:grid;place-items:center;width:36px;height:36px;color:var(--dancr-color-brand-primary)!important}html body.dancr-button-system #dancer-venue-verification .dancer-nfc-next-step-icon svg{width:32px;height:32px}html body.dancr-button-system #dancer-venue-verification .dancer-nfc-next-step h3{margin:0;font-size:18px!important;line-height:1.25;font-weight:750;color:var(--dancr-color-text-primary)!important}html body.dancr-button-system #dancer-venue-verification .dancer-nfc-next-step p{grid-column:1/-1;margin:0;font-size:14px!important;line-height:1.5;color:var(--dancr-color-text-primary)!important}html body.dancr-button-system #dancer-venue-verification .dancer-nfc-approval-details{display:grid;gap:10px;margin-bottom:8px}html body.dancr-button-system #dancer-venue-verification .dancer-nfc-approval-details p{margin:0;font-size:13px!important;line-height:1.5}}",
  "@layer dancr-follow-controls{html body.dancr-button-system #dancer-venue-verification[data-first-tap] .dancer-nfc-refresh{width:auto!important;max-width:100%!important;min-height:44px!important;padding:8px 4px!important}html body.dancr-button-system #dancer-venue-verification[data-first-tap] .dancer-nfc-refresh::before{content:none!important}html body.dancr-button-system #dancer-venue-verification[data-first-tap] .dancer-nfc-refresh:enabled:hover{text-decoration:underline!important}}",
  ".dashboard-shell .dancer-nfc-guide{display:grid;gap:15px;margin:18px 0;padding:0;list-style:none;counter-reset:tap-step}.dashboard-shell .dancer-nfc-guide>li{position:relative;display:grid;gap:3px;padding:0 0 0 34px;border:0;background:none;box-shadow:none;counter-increment:tap-step}.dancer-nfc-guide>li:before{content:counter(tap-step);position:absolute;left:0;top:0;width:23px;height:23px;display:grid;place-items:center;border:1px solid var(--dancr-color-border);border-radius:50%;color:var(--dancr-color-text-primary);font-size:11px;font-weight:700}.dancer-nfc-guide strong{font-size:14px;line-height:1.4;color:#fff}.dancer-nfc-guide span{font-size:13px;line-height:1.5;color:var(--dancr-color-text-muted)}",
  ".dashboard-shell details.dancer-nfc-details{margin:16px 0;padding:0;border:0;border-top:1px solid #ffffff14;border-radius:0;background:none;box-shadow:none}.dancer-nfc-details>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 0;color:var(--dancr-color-text-primary);font-size:12px;font-weight:600;cursor:pointer;list-style:none}.dancer-nfc-details>summary::-webkit-details-marker{display:none}.dancer-nfc-details>summary:after{content:'+';margin-left:auto;font-size:18px}.dancer-nfc-details[open]>summary:after{content:'−'}.dancer-nfc-details>summary:focus-visible{outline:2px solid var(--dancr-color-brand-primary);outline-offset:2px}.dashboard-shell .dancer-nfc-details ul{margin:0;padding-left:18px}.dashboard-shell .dancer-nfc-details li,.dashboard-shell .dancer-nfc-details p{margin:0 0 10px;font-size:12px;line-height:1.5;color:var(--dancr-color-text-muted)}",
  ".dancer-nfc-panel p,.dancer-nfc-panel small,.dancer-nfc-notes{color:var(--dancr-color-text-muted);line-height:1.45}.dancer-nfc-roster{display:grid;gap:7px;margin:14px 0}.dancer-nfc-roster section{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid rgba(69,255,165,.18);border-radius:11px;background:rgba(34,201,129,.06)}",
  ".dancer-nfc-roster span{display:grid;gap:2px}.dancer-nfc-roster small{font-size:11px}.dancer-nfc-roster button,.dancer-nfc-refresh{min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.15);border-radius:9px;color:#fff;background:rgba(255,255,255,.06);font:inherit;font-weight:800;cursor:pointer}",
  ".dancer-nfc-status{font-size:12px}.dancer-nfc-refresh{margin:0 0 10px}.dancer-nfc-panel small{display:block}.dashboard-shell .dancer-nfc-panel .dancer-nfc-refresh{width:100%;min-height:44px;margin:0;font-size:13px}",
  ".dashboard-shell .dancer-nfc-panel-compact{padding:0!important}.dancer-nfc-panel-compact>summary{box-sizing:border-box;min-height:68px;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;padding:10px 12px;cursor:pointer;list-style:none}.dancer-nfc-panel-compact>summary::-webkit-details-marker{display:none}.dancer-nfc-panel-compact>summary:focus-visible{outline:2px solid var(--dancr-color-brand-primary);outline-offset:-3px}.dancer-nfc-compact-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;color:#70ffc1;background:rgba(34,201,129,.11)}.dancer-nfc-compact-icon svg{width:24px;height:24px;stroke:currentColor;stroke-width:1.7}.dancer-nfc-compact-copy{min-width:0;display:grid;gap:3px}.dancer-nfc-compact-copy strong{color:#fff;font-size:16px}.dancer-nfc-compact-copy small{color:var(--dancr-color-text-muted);font-size:11px}.dancer-nfc-compact-action{padding:6px 9px;border:1px solid rgba(69,255,165,.24);border-radius:999px;color:#70ffc1;font-size:10px;font-weight:900}.dancer-nfc-panel-compact[open] .dancer-nfc-compact-action{color:#fff}.dancer-nfc-compact-body{display:grid;gap:10px;padding:0 12px 12px;border-top:1px solid rgba(255,255,255,.08)}.dancer-nfc-compact-body>p{margin:12px 0 0;color:var(--dancr-color-text-muted);line-height:1.45}",
  "@media(max-width:620px){.dancer-nfc-roster section{align-items:flex-start}}",
].join("");
