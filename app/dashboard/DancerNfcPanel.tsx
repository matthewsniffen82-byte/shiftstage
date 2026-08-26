"use client";

import { useState } from "react";
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
  const activeAffiliations = affiliations.filter((item) => item.status === "active");
  const enrollment = nfcState.enrollment;
  const authorized = nfcState.profileAuthorization?.authorized === true || activeAffiliations.length > 0;
  const isPublic = nfcState.profileAuthorization?.isPublic === true;
  const pendingEnrollment = enrollment?.status === "pending";

  async function refresh() {
    setPendingId("refresh");
    setStatus("");
    try {
      const data = await requestDancerVenueVerificationJson({
        cache: "no-store",
        fallbackMessage: "Unable to refresh venue access.",
      });
      setAffiliations(data.affiliations || []);
      setNfcState({ profileAuthorization: data.profileAuthorization, enrollment: data.enrollment });
      await onAuthorizationChange?.();
      setStatus("Dressing-room tap access is current.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refresh venue access.");
    } finally {
      setPendingId("");
    }
  }

  async function removeAffiliation(affiliation: Affiliation) {
    if (!affiliation.id) return;
    const venueName = affiliation.venue?.name || "this venue";
    if (!window.confirm(`Remove venue access for ${venueName}? You will need to tap its dressing-room sticker again before going Working Now there.`)) return;
    setPendingId(affiliation.id);
    setStatus("");
    try {
      const data = await requestDancerVenueVerificationJson({
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ affiliationId: affiliation.id }),
        fallbackMessage: "Unable to remove venue access.",
      });
      setAffiliations((current) => current.map((item) => item.id === affiliation.id ? { ...item, status: "revoked" } : item));
      setStatus(data.message || "Venue access removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove venue access.");
    } finally {
      setPendingId("");
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
          <p>Tap an authorized club&apos;s official dressing-room sticker each time you arrive to appear in Working Now for six hours.</p>
          {affiliationRoster}
          <div className="dancer-nfc-notes">
            <span>Retaps never extend a Working Now session, and no phone location is collected.</span>
            <span>A six-hour cooldown follows each session.</span>
          </div>
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
      <div className="dancer-nfc-icon"><NfcIcon /></div>
      <div className="dancer-nfc-content">
        <span className="eyebrow">Dressing-room tap</span>
        <div className="dancer-nfc-heading">
          <h2>{authorized ? "Profile and venue approved" : pendingEnrollment ? "Tap saved" : "Tap to approve your profile"}</h2>
          <b>{authorized ? "APPROVED" : pendingEnrollment ? "FINISH SETUP" : "TAP REQUIRED"}</b>
        </div>
        {authorized ? (
          <p>Your approved dressing-room tap added this venue. Each time you arrive, tap that venue&apos;s official tag to appear in Working Now for six hours.</p>
        ) : pendingEnrollment ? (
          <p>Your tap at {enrollment?.venue?.name || "the club"} is saved. Complete profile setup and media review; MyDancr will activate the venue automatically when the profile is ready.</p>
        ) : (
          <p>At the club, unlock your signed-in phone and tap its official MyDancr dressing-room sticker. When setup is complete, the first eligible tap approves your profile, connects that venue, and starts one six-hour Working Now session.</p>
        )}

        {affiliationRoster}

        <div className="dancer-nfc-notes">
          <span>Each eligible tap starts one six-hour Working Now session; retaps never extend it and no phone location is collected.</span>
          <span>A six-hour cooldown follows. No venue tag can start another session until that cooldown ends.</span>
          <span>Upcoming venue dates are optional and never make you Working Now by themselves.</span>
          <span>Media safety moderation remains separate{isPublic ? "; your profile is live." : " and must finish before the profile is public."}</span>
        </div>
        <button className="dancer-nfc-refresh" type="button" disabled={Boolean(pendingId)} onClick={refresh}>
          {pendingId === "refresh" ? "Refreshing…" : "Refresh access"}
        </button>
        {status ? <p className="dancer-nfc-status" role="status">{status}</p> : null}
        <small>Only an active MyDancr-supplied dressing-room sticker can authorize this action.</small>
      </div>
      <style>{DANCER_NFC_STYLE}</style>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const DANCER_NFC_STYLE = [
  ".dancer-nfc-panel{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:start;border-color:rgba(126,87,255,.34);background:radial-gradient(circle at 0 0,rgba(116,60,255,.14),transparent 22rem),rgba(12,12,18,.88)}",
  ".dancer-nfc-panel.is-authorized{border-color:rgba(73,255,170,.34);background:radial-gradient(circle at 0 0,rgba(25,190,116,.14),transparent 22rem),rgba(9,15,14,.9)}",
  ".dancer-nfc-icon{width:64px;height:64px;display:grid;place-items:center;border-radius:50%;color:#fff;background:linear-gradient(145deg,#4314b8,#842cff);box-shadow:0 0 28px rgba(125,59,255,.42)}",
  ".is-authorized .dancer-nfc-icon{background:linear-gradient(145deg,#087a52,#22cb83);box-shadow:0 0 28px rgba(41,223,145,.3)}",
  ".dancer-nfc-icon svg{width:38px;height:38px;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}",
  ".dancer-nfc-content{min-width:0}.dancer-nfc-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.dancer-nfc-heading h2,.dancer-nfc-panel p{margin:4px 0}",
  ".dancer-nfc-heading b{padding:6px 9px;border:1px solid rgba(142,102,255,.36);border-radius:999px;color:#c8b9ff;font-size:9px;letter-spacing:.1em;white-space:nowrap}.is-authorized .dancer-nfc-heading b{border-color:rgba(69,255,165,.36);color:#70ffc1}",
  ".dancer-nfc-panel p,.dancer-nfc-panel small,.dancer-nfc-notes{color:#b9accd;line-height:1.45}.dancer-nfc-roster{display:grid;gap:7px;margin:14px 0}.dancer-nfc-roster section{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid rgba(69,255,165,.18);border-radius:11px;background:rgba(34,201,129,.06)}",
  ".dancer-nfc-roster span{display:grid;gap:2px}.dancer-nfc-roster small{font-size:11px}.dancer-nfc-roster button,.dancer-nfc-refresh{min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.15);border-radius:9px;color:#fff;background:rgba(255,255,255,.06);font:inherit;font-weight:800;cursor:pointer}",
  ".dancer-nfc-notes{display:grid;gap:6px;margin:12px 0;font-size:12px}.dancer-nfc-notes span{padding-left:15px;position:relative}.dancer-nfc-notes span:before{content:'✓';position:absolute;left:0;color:#5fffb5}.dancer-nfc-status{font-size:12px}.dancer-nfc-refresh{margin:0 0 10px}.dancer-nfc-panel small{display:block}",
  ".dashboard-shell .dancer-nfc-panel-compact{padding:0!important}.dancer-nfc-panel-compact>summary{box-sizing:border-box;min-height:68px;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;padding:10px 12px;cursor:pointer;list-style:none}.dancer-nfc-panel-compact>summary::-webkit-details-marker{display:none}.dancer-nfc-panel-compact>summary:focus-visible{outline:2px solid #8b5cf6;outline-offset:-3px}.dancer-nfc-compact-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;color:#70ffc1;background:rgba(34,201,129,.11)}.dancer-nfc-compact-icon svg{width:24px;height:24px;stroke:currentColor;stroke-width:1.7}.dancer-nfc-compact-copy{min-width:0;display:grid;gap:3px}.dancer-nfc-compact-copy strong{color:#fff;font-size:16px}.dancer-nfc-compact-copy small{color:#b9accd;font-size:11px}.dancer-nfc-compact-action{padding:6px 9px;border:1px solid rgba(69,255,165,.24);border-radius:999px;color:#70ffc1;font-size:10px;font-weight:900}.dancer-nfc-panel-compact[open] .dancer-nfc-compact-action{color:#fff}.dancer-nfc-compact-body{display:grid;gap:10px;padding:0 12px 12px;border-top:1px solid rgba(255,255,255,.08)}.dancer-nfc-compact-body>p{margin:12px 0 0;color:#b9accd;line-height:1.45}",
  "@media(max-width:620px){.dancer-nfc-panel{grid-template-columns:1fr}.dancer-nfc-icon{width:54px;height:54px}.dancer-nfc-icon svg{width:32px;height:32px}.dancer-nfc-heading{align-items:flex-start;flex-direction:column}.dancer-nfc-roster section{align-items:flex-start}}",
].join("");
